// Standalone worker process that performs the heavy replace work off the request path.
// Run it in its OWN terminal alongside the API server: `npm run worker`.
require('dotenv').config();

const { Worker } = require('bullmq');
const prisma = require('../lib/prisma');
const { connection, REPLACE_QUEUE_NAME } = require('../lib/queue');
// Reuse the SAME helpers the controller/search use, so replace matches search exactly.
const {
  buildSearchRegex,
  escapeReplacementDollarSigns,
  applyCasePattern,
} = require('../lib/textReplace');

// The processor for a single replace job. Anything it throws marks that one job as
// failed (handled below) but never stops the worker from processing future jobs.
async function processReplaceJob(job) {
  const { jobId, word, replacement, caseSensitive, wholeWord } = job.data;
  console.log(`[replace-worker] START queue-job ${job.id} → db-job ${jobId}`);

  // Fetch the job + files fresh from the DB. We only trust ids + parameters from the
  // payload, never stale content.
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: { files: true },
  });
  if (!dbJob) {
    throw new Error(`Job ${jobId} no longer exists.`);
  }

  // Same regex as search. Always replace from the ORIGINAL content so re-runs
  // overwrite cleanly instead of compounding.
  const regex = buildSearchRegex(word, { caseSensitive, wholeWord });

  const perFile = dbJob.files.map((file) => {
    const replacements = file.content.match(regex)?.length ?? 0;
    // Case-sensitive: insert the typed replacement literally (existing behavior).
    // Case-insensitive: copy each match's simple case pattern onto the replacement.
    // Function replacer: $ in the return value is literal, so no $$ escaping here.
    const replacedContent = caseSensitive
      ? file.content.replace(regex, escapeReplacementDollarSigns(replacement))
      : file.content.replace(regex, (matched) =>
          applyCasePattern(matched, replacement)
        );
    return { id: file.id, replacements, replacedContent };
  });
  const totalReplacements = perFile.reduce((sum, f) => sum + f.replacements, 0);

  // Single transaction: per-file results + job completion, mirroring the old inline
  // logic. Clear errorMessage in case this is a retry of a previously-failed job.
  await prisma.$transaction([
    ...perFile.map((f) =>
      prisma.jobFile.update({
        where: { id: f.id },
        data: { replacedContent: f.replacedContent, matchCount: f.replacements },
      })
    ),
    prisma.job.update({
      where: { id: dbJob.id },
      data: {
        status: 'COMPLETED',
        searchWord: word,
        replaceWord: replacement,
        totalMatches: totalReplacements,
        errorMessage: null,
      },
    }),
  ]);

  console.log(
    `[replace-worker] DONE queue-job ${job.id}: ${totalReplacements} replacement(s) across ${perFile.length} file(s)`
  );
  return { totalReplacements };
}

const worker = new Worker(REPLACE_QUEUE_NAME, processReplaceJob, { connection });

// On failure, mark the DB Job FAILED with a reason so the status endpoint can report
// it. This runs in addition to BullMQ recording the failure; it must never throw.
worker.on('failed', async (job, err) => {
  console.error(`[replace-worker] FAILED queue-job ${job?.id}:`, err);
  const jobId = job?.data?.jobId;
  if (!jobId) return;
  try {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        // Cap the stored message so a giant stack/message can't bloat the row.
        errorMessage: String(err?.message ?? 'Unknown error').slice(0, 500),
      },
    });
  } catch (updateErr) {
    console.error(`[replace-worker] could not mark db-job ${jobId} FAILED:`, updateErr);
  }
});

// Connection-level errors (e.g. Redis down) — log, don't crash.
worker.on('error', (err) => {
  console.error('[replace-worker] worker error:', err);
});

console.log(`[replace-worker] listening on queue "${REPLACE_QUEUE_NAME}"…`);

// Graceful shutdown so Ctrl+C closes the Redis connection cleanly.
async function shutdown() {
  console.log('[replace-worker] shutting down…');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
