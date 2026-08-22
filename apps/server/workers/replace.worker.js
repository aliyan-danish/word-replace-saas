// Standalone worker process that performs the heavy replace work off the request path.
// Run it in its OWN terminal alongside the API server: `npm run worker`.
require('dotenv').config();

const { Worker } = require('bullmq');
const prisma = require('../lib/prisma');
const { connection, REPLACE_QUEUE_NAME } = require('../lib/queue');
// Reuse the SAME helpers the controller/search use, so replace matches search exactly.
const { replaceInStoredFile } = require('../lib/fileFormats');

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
        isRegex: Boolean(data.isRegex),
      },
    ];
  }
  return [];
}

// The processor for a single replace job. Anything it throws marks that one job as
// failed (handled below) but never stops the worker from processing future jobs.
async function processReplaceJob(job) {
  const { jobId, caseSensitive, wholeWord, isRegex } = job.data;
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

  // Route each file by extension (txt/html/xml/docx/pdf). Always start from ORIGINAL
  // stored content so re-runs do not compound. Matching is still single-pass via
  // replacePlainText — never sequential per-pair replace.
  const perFile = [];
  for (const file of dbJob.files) {
    const { stored, count } = await replaceInStoredFile(file.filename, file.content, pairs, {
      caseSensitive,
      wholeWord,
      isRegex: Boolean(isRegex),
    });
    perFile.push({ id: file.id, replacements: count, replacedContent: stored });
  }
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
