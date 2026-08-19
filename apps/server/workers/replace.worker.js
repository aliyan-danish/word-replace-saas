// Standalone worker process that performs the heavy replace work off the request path.
// Run it in its OWN terminal alongside the API server: `npm run worker`.
require('dotenv').config();

const { Worker } = require('bullmq');
const prisma = require('../lib/prisma');
const { connection, REPLACE_QUEUE_NAME } = require('../lib/queue');
// Reuse the SAME helpers the controller/search use, so replace matches search exactly.
const {
  buildMultiWordRegex,
  findPairForMatch,
  applyCasePattern,
} = require('../lib/textReplace');

// Resolve queue payload to a pairs array. New jobs send `pairs`; older queued jobs
// still have a single word/replacement.
function resolvePairs(data) {
  if (Array.isArray(data.pairs) && data.pairs.length > 0) {
    return data.pairs;
  }
  if (typeof data.word === 'string') {
    return [
      {
        word: data.word,
        replacement: data.replacement ?? '',
        caseSensitive: Boolean(data.caseSensitive),
        wholeWord: Boolean(data.wholeWord),
      },
    ];
  }
  return [];
}

// The processor for a single replace job. Anything it throws marks that one job as
// failed (handled below) but never stops the worker from processing future jobs.
async function processReplaceJob(job) {
  const { jobId, caseSensitive, wholeWord } = job.data;
  const pairs = resolvePairs(job.data);
  console.log(`[replace-worker] START queue-job ${job.id} → db-job ${jobId}`);

  if (pairs.length === 0) {
    throw new Error('Replace job is missing word pairs.');
  }

  // Fetch the job + files fresh from the DB. We only trust ids + parameters from the
  // payload, never stale content.
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: { files: true },
  });
  if (!dbJob) {
    throw new Error(`Job ${jobId} no longer exists.`);
  }

  // ONE combined regex over ORIGINAL content. Sequential per-pair replace would
  // cascade (apple→banana then banana→cherry turns apple into cherry).
  const regex = buildMultiWordRegex(
    pairs.map((pair) => pair.word),
    { caseSensitive, wholeWord }
  );

  const perFile = dbJob.files.map((file) => {
    regex.lastIndex = 0;
    const replacements = file.content.match(regex)?.length ?? 0;
    regex.lastIndex = 0;
    // Function replacer so each match can look up its own pair. $ is literal here,
    // so we do not $$ -escape. Case-sensitive still inserts the typed replacement;
    // case-insensitive still uses applyCasePattern unchanged.
    const replacedContent = file.content.replace(regex, (matched) => {
      const pair = findPairForMatch(matched, pairs, caseSensitive);
      if (!pair) return matched;
      if (caseSensitive) return pair.replacement;
      return applyCasePattern(matched, pair.replacement);
    });
    return { id: file.id, replacements, replacedContent };
  });
  const totalReplacements = perFile.reduce((sum, f) => sum + f.replacements, 0);

  // Keep searchWord/replaceWord as a short summary for older clients; wordPairs is
  // the real list (flags included on each pair).
  const searchWord =
    pairs.length === 1 ? pairs[0].word : pairs.map((p) => p.word).join(', ');
  const replaceWord =
    pairs.length === 1 ? pairs[0].replacement : pairs.map((p) => p.replacement).join(', ');

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
        searchWord,
        replaceWord,
        wordPairs: pairs,
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
