const path = require('path');
const AdmZip = require('adm-zip');
const prisma = require('../lib/prisma');
const { replaceQueue } = require('../lib/queue');
// Search still runs inline (read-only + cheap); it shares fileFormats with the
// replace worker so search counts and replace cannot diverge.
const {
  countInStoredFile,
  encodeStoredContent,
  isSupportedExt,
  storedToDownloadBuffer,
  FormatParseError,
} = require('../lib/fileFormats');

// Cap how many pairs one job can carry so a huge payload can't explode the regex.
const MAX_WORD_PAIRS = 20;
// Subscription/trial enforcement for uploads. PRO_PLAN_MISSING lets us surface a clear
// "run the seed" 500 if the backfill can't find the PRO plan.
const { getEnforcedSubscription, PRO_PLAN_MISSING } = require('../lib/subscription');
const { validateRegexPatterns } = require('../lib/regexSafety');

// Hard caps on uncompressed zip content. Checked via entry.header.size BEFORE
// calling getData(), so a zip bomb is rejected without ever expanding into memory.
// Per-file (20MB) is well above the 10MB whole-upload compressed ceiling for normal
// text; the total (50MB) blocks many medium files that individually look fine.
const MAX_UNCOMPRESSED_BYTES_PER_FILE = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES_TOTAL = 50 * 1024 * 1024;

// Decide whether a zip entry is a supported job file, filtering out directories
// and OS/editor junk (macOS resource forks, .DS_Store, dotfiles).
function isWantedZipEntry(entry) {
  if (entry.isDirectory) return false;

  const entryName = entry.entryName; // full path within the archive, forward-slashed
  if (entryName.startsWith('__MACOSX/')) return false;

  const base = path.posix.basename(entryName);
  if (base === '.DS_Store') return false;
  if (base.startsWith('.')) return false; // skip hidden files like ._foo or .gitkeep

  return isSupportedExt(path.posix.extname(base));
}

// Turn a .zip buffer into a list of { filename, content, size }. Mixed formats in
// one archive are allowed; each entry is routed by extension. `maxFiles` is the
// caller's plan-derived cap. Throws ZipError on invalid/empty/oversized archives.
function extractSupportedFilesFromZip(buffer, maxFiles) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ZipError('The uploaded .zip file is invalid or corrupted.');
  }

  const wanted = zip.getEntries().filter(isWantedZipEntry);

  if (wanted.length === 0) {
    throw new ZipError(
      'The .zip file contains no supported files (.txt, .html, .xml, .docx, .pdf).'
    );
  }
  if (wanted.length > maxFiles) {
    throw new ZipError(
      `The .zip contains ${wanted.length} supported files, which exceeds your plan's limit of ${maxFiles} files per upload.`
    );
  }

  // Zip-bomb protection: use declared uncompressed sizes from the central directory
  // (entry.header.size) BEFORE decompressing. Never call getData() first.
  let totalUncompressed = 0;
  for (const entry of wanted) {
    const declaredSize = entry.header && entry.header.size;
    if (typeof declaredSize !== 'number' || declaredSize < 0) {
      throw new ZipError(
        `Could not read the uncompressed size of "${path.posix.basename(entry.entryName)}". The archive may be invalid.`
      );
    }
    if (declaredSize > MAX_UNCOMPRESSED_BYTES_PER_FILE) {
      throw new ZipError(
        `"${path.posix.basename(entry.entryName)}" expands to more than ${MAX_UNCOMPRESSED_BYTES_PER_FILE / (1024 * 1024)}MB uncompressed, which exceeds the per-file limit.`
      );
    }
    totalUncompressed += declaredSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES_TOTAL) {
      throw new ZipError(
        `The .zip expands to more than ${MAX_UNCOMPRESSED_BYTES_TOTAL / (1024 * 1024)}MB uncompressed across all files, which exceeds the total limit.`
      );
    }
  }

  return wanted.map((entry) => {
    const raw = entry.getData();
    const filename = path.posix.basename(entry.entryName);
    return {
      filename,
      content: encodeStoredContent(filename, raw),
      size: raw.length,
    };
  });
}

// Signals a client-fixable problem with the zip; mapped to HTTP 400 in the handler.
class ZipError extends Error {}

// Accept the new `words` array, or a legacy single `word` string.
function normalizeSearchWords(body) {
  if (Array.isArray(body.words)) return body.words;
  if (typeof body.word === 'string') return [body.word];
  return null;
}

// Accept the new `pairs` array, or a legacy `{ word, replacement }`.
function normalizeReplacePairs(body) {
  if (Array.isArray(body.pairs)) return body.pairs;
  if (typeof body.word === 'string' && typeof body.replacement === 'string') {
    return [{ word: body.word, replacement: body.replacement }];
  }
  return null;
}

// Shared validation for search words / replace-pair words. Returns { words } or { error }.
// Regex patterns are unique by exact source (so [A-Z] and [a-z] do not collide).
function parseWordList(rawWords, caseSensitive, { isRegex } = {}) {
  if (!Array.isArray(rawWords) || rawWords.length === 0) {
    return { error: 'Provide at least one non-empty search word.' };
  }
  if (rawWords.length > MAX_WORD_PAIRS) {
    return {
      error: `A job can include at most ${MAX_WORD_PAIRS} word pairs.`,
    };
  }

  const words = [];
  const seen = new Set();
  for (let i = 0; i < rawWords.length; i += 1) {
    const value = rawWords[i];
    if (typeof value !== 'string' || value.trim() === '') {
      return { error: 'Every search word must be a non-empty string.' };
    }
    const word = value.trim();
    const key = isRegex || caseSensitive ? word : word.toLowerCase();
    if (seen.has(key)) {
      return { error: 'Each search word must be unique within the job.' };
    }
    seen.add(key);
    words.push(word);
  }
  return { words };
}

// Stamp the job's shared toggles onto every pair so a later per-pair UI can
// read them without another schema change.
function stampPairFlags(pairs, caseSensitive, wholeWord, isRegex) {
  return pairs.map((pair) => ({
    word: pair.word,
    replacement: pair.replacement,
    caseSensitive,
    wholeWord,
    isRegex,
  }));
}

async function uploadJob(req, res) {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'No file uploaded. Send a file in the "file" field.' });
    }

    // --- Subscription / trial enforcement (runs BEFORE any parsing or DB writes) ---
    const now = new Date();

    // Resolve the caller's subscription: backfills a trial for pre-subscription accounts
    // and lazily flips an expired trial to EXPIRED (single source of truth for expiry).
    const subscription = await getEnforcedSubscription(req.user.id, now);
    const plan = subscription.plan;

    // Gate: an expired trial or canceled plan can't upload at all.
    if (subscription.status === 'EXPIRED' || subscription.status === 'CANCELED') {
      return res.status(403).json({
        error: 'Your trial has ended. Upgrade to Pro to continue uploading files.',
      });
    }

    // Monthly job quota — only meaningful when the plan caps it (FREE). PRO has
    // monthlyJobLimit = null (unlimited), so this block is skipped for trial/PRO users.
    if (plan.monthlyJobLimit != null) {
      // Start of the current calendar month in server-local time.
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const jobsThisMonth = await prisma.job.count({
        where: { userId: req.user.id, createdAt: { gte: startOfMonth } },
      });
      if (jobsThisMonth >= plan.monthlyJobLimit) {
        return res.status(403).json({
          error: `You've reached your plan's limit of ${plan.monthlyJobLimit} uploads this month.`,
        });
      }
    }

    const { originalname, buffer } = req.file;
    const isZip = path.extname(originalname).toLowerCase() === '.zip';

    // Per-plan upload-size limit, checked against the ACTUAL uploaded bytes (not the fixed
    // multer ceiling). multer already rejected anything over the absolute 10MB max before
    // we got here; this narrows it to the caller's plan (e.g. 2MB on FREE).
    if (buffer.length > plan.maxUploadBytes) {
      const limitMb = (plan.maxUploadBytes / (1024 * 1024)).toFixed(2);
      return res.status(400).json({
        error: `File is ${(buffer.length / (1024 * 1024)).toFixed(2)}MB, which exceeds your plan's ${limitMb}MB upload limit.`,
      });
    }

    // Build the list of files to persist. The per-plan file-count cap is enforced during
    // zip extraction so a huge archive is rejected before creating any rows.
    let files;
    if (isZip) {
      files = extractSupportedFilesFromZip(buffer, plan.maxFilesPerJob);
    } else {
      files = [
        {
          filename: originalname,
          content: encodeStoredContent(originalname, buffer),
          size: buffer.length,
        },
      ];
    }

    // Single transaction: the nested `create` writes the Job and all JobFile rows
    // atomically, so we never end up with a Job that has no files.
    const job = await prisma.job.create({
      data: {
        userId: req.user.id,
        // PENDING is the initial "uploaded / ready to scan" state in the JobStatus enum
        // (there is no dedicated UPLOADED value).
        status: 'PENDING',
        originalName: originalname,
        isZip,
        files: { create: files },
      },
      include: { files: true },
    });

    const totalSize = job.files.reduce((sum, file) => sum + file.size, 0);

    return res.status(201).json({
      jobId: job.id,
      totalFiles: job.files.length,
      totalSize,
      files: job.files.map((file) => ({
        id: file.id,
        filename: file.filename,
        size: file.size,
      })),
    });
  } catch (err) {
    if (err instanceof ZipError) {
      return res.status(400).json({ error: err.message });
    }
    // Backfill couldn't find the PRO plan (seed never run): tell the developer clearly
    // rather than emitting a generic 500.
    if (err instanceof Error && err.message === PRO_PLAN_MISSING) {
      console.error('uploadJob error: PRO plan not found — run the seed script (npm run seed)');
      return res.status(500).json({
        error: 'Subscription plans are not configured. Run the seed script (npm run seed) to create the FREE and PRO plans.',
      });
    }
    // Never leak stack traces / internals to the client.
    console.error('uploadJob error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while processing the upload.' });
  }
}

async function searchJob(req, res) {
  try {
    const { jobId } = req.params;
    const body = req.body || {};

    // Normalize optional toggles to real booleans so the echoed response is clean.
    const caseSensitive = Boolean(body.caseSensitive);
    const wholeWord = Boolean(body.wholeWord);
    const isRegex = Boolean(body.isRegex);

    const parsed = parseWordList(normalizeSearchWords(body), caseSensitive, { isRegex });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const { words } = parsed;

    // Validate BEFORE counting: search runs in-process, so a ReDoS pattern
    // would hang the API. Worker is never the first line of defense.
    if (isRegex) {
      const regexCheck = validateRegexPatterns(words, { caseSensitive });
      if (regexCheck.error) {
        return res.status(400).json({ error: regexCheck.error });
      }
    }

    // Fetch the job with its files. We scope ownership after fetching so we can
    // return an identical 404 whether the job is missing or owned by someone else
    // (never reveal that another user's job exists).
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { files: true },
    });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // Count against ORIGINAL content with the same combined regex the worker uses,
    // so per-word totals match what replace will actually change.
    let totalOccurrences = 0;
    const wordTotals = Object.fromEntries(
      words.map((word) => [caseSensitive || isRegex ? word : word.toLowerCase(), 0])
    );

    const files = [];
    for (const file of job.files) {
      const byKey = await countInStoredFile(file.filename, file.content, words, {
        caseSensitive,
        wholeWord,
        isRegex,
      });
      const byWord = words.map((word) => {
        const key = caseSensitive || isRegex ? word : word.toLowerCase();
        const occurrences = byKey[key] ?? 0;
        wordTotals[key] += occurrences;
        totalOccurrences += occurrences;
        return { word, occurrences };
      });
      const occurrences = byWord.reduce((sum, item) => sum + item.occurrences, 0);
      files.push({ id: file.id, filename: file.filename, occurrences, words: byWord });
    }

    return res.status(200).json({
      jobId: job.id,
      words,
      caseSensitive,
      wholeWord,
      isRegex,
      totalOccurrences,
      byWord: words.map((word) => ({
        word,
        totalOccurrences: wordTotals[caseSensitive || isRegex ? word : word.toLowerCase()] ?? 0,
      })),
      files,
    });
  } catch (err) {
    if (err instanceof FormatParseError) {
      return res.status(400).json({ error: err.message });
    }
    // Never leak internals to the client.
    console.error('searchJob error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while searching the files.' });
  }
}

async function replaceJob(req, res) {
  try {
    const { jobId } = req.params;
    const body = req.body || {};

    const caseSensitive = Boolean(body.caseSensitive);
    const wholeWord = Boolean(body.wholeWord);
    const isRegex = Boolean(body.isRegex);

    const rawPairs = normalizeReplacePairs(body);
    if (!rawPairs) {
      return res.status(400).json({
        error: 'A "pairs" array of { word, replacement } is required.',
      });
    }

    const parsed = parseWordList(
      rawPairs.map((pair) => (pair && typeof pair.word === 'string' ? pair.word : '')),
      caseSensitive,
      { isRegex }
    );
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    for (const pair of rawPairs) {
      if (!pair || typeof pair.replacement !== 'string') {
        return res.status(400).json({
          error: 'Each pair needs a "replacement" string (use "" to delete the word).',
        });
      }
    }

    if (isRegex) {
      const regexCheck = validateRegexPatterns(parsed.words, { caseSensitive });
      if (regexCheck.error) {
        return res.status(400).json({ error: regexCheck.error });
      }
    }

    // Copy the shared job toggles onto every pair (stored for a future per-pair UI).
    const pairs = stampPairFlags(
      parsed.words.map((word, i) => ({
        word,
        replacement: rawPairs[i].replacement,
      })),
      caseSensitive,
      wholeWord,
      isRegex
    );

    // Ownership check — identical to searchJob: a missing job and someone else's
    // job both return the same generic 404. (No need to include files here; the worker
    // fetches them fresh when it runs.)
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // The actual regex/replace work is heavy, so it's offloaded to the BullMQ
    // "replace-jobs" worker (per the architecture rule). We mark the job REPLACING
    // BEFORE enqueueing so a client polling /status never sees a stale COMPLETED/PENDING
    // between enqueue and the worker picking it up. Clear any prior errorMessage so a
    // retry of a previously-failed job starts clean.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'REPLACING', errorMessage: null },
    });

    // Enqueue with just the ids + parameters. The worker re-reads file content from
    // the DB rather than trusting anything stale in the payload.
    await replaceQueue.add('replace', {
      jobId: job.id,
      pairs,
      caseSensitive,
      wholeWord,
      isRegex,
    });

    // Respond immediately; the client polls GET /:jobId/status for completion.
    return res.status(202).json({
      jobId: job.id,
      status: 'REPLACING',
      message: 'Replacement job queued.',
    });
  } catch (err) {
    console.error('replaceJob error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while queueing the replacement.' });
  }
}

async function statusJob(req, res) {
  try {
    const { jobId } = req.params;

    // Same auth + ownership pattern as the other job endpoints.
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // Always return status; include the result fields only once they exist so a
    // freshly-uploaded job doesn't report misleading nulls. Note: `!= null` catches
    // both null and undefined while still allowing an empty-string replaceWord (a
    // valid "delete the word" result).
    const payload = { jobId: job.id, status: job.status };
    if (job.totalMatches != null) payload.totalMatches = job.totalMatches;
    if (job.searchWord != null) payload.searchWord = job.searchWord;
    if (job.replaceWord != null) payload.replaceWord = job.replaceWord;
    if (job.wordPairs != null) payload.wordPairs = job.wordPairs;
    // Surface the failure reason when a job has failed (extra beyond the base spec,
    // but useful for a polling client).
    if (job.status === 'FAILED' && job.errorMessage) payload.errorMessage = job.errorMessage;

    return res.status(200).json(payload);
  } catch (err) {
    console.error('statusJob error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while fetching the job status.' });
  }
}

async function downloadJob(req, res) {
  try {
    const { jobId } = req.params;

    // 1. Ownership check — same generic 404 as search/replace for missing or
    // not-owned jobs.
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { files: true },
    });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // 2. Precondition: only a completed (replaced) job has results to download.
    if (job.status !== 'COMPLETED') {
      return res
        .status(400)
        .json({ error: 'Run replace before downloading results.' });
    }

    // 3. Build the zip in memory. We construct the whole buffer BEFORE writing any
    // response headers, so if anything throws we can still return clean JSON (see 5).
    const zip = new AdmZip();
    for (const file of job.files) {
      let text = file.replacedContent;
      if (text === null || text === undefined) {
        // Shouldn't happen (replace processes every file), but never emit an empty
        // file: fall back to the original content and flag it server-side.
        console.warn(
          `downloadJob: replacedContent missing for file ${file.id} (${file.filename}); falling back to original content.`
        );
        text = file.content;
      }
      zip.addFile(file.filename, storedToDownloadBuffer(file.filename, text));
    }

    const zipBuffer = zip.toBuffer();

    // 4. Send as a real attachment. job.id is a server-generated UUID, so the
    // filename is safe (no user-controlled input in the header).
    return res
      .status(200)
      .set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="job-${job.id}-results.zip"`,
        'Content-Length': zipBuffer.length,
      })
      .send(zipBuffer);
  } catch (err) {
    console.error('downloadJob error:', err);
    // If headers/body already went out we can't send JSON; just end the response.
    if (res.headersSent) {
      return res.end();
    }
    return res
      .status(500)
      .json({ error: 'Something went wrong while building the download.' });
  }
}

async function listJobs(req, res) {
  try {
    // Only the caller's own jobs, newest first. `_count` gives the number of associated
    // JobFile rows without loading their (potentially large) content.
    const jobs = await prisma.job.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { files: true } } },
    });

    const payload = jobs.map((job) => {
      const item = {
        id: job.id,
        originalName: job.originalName,
        isZip: job.isZip,
        status: job.status,
        createdAt: job.createdAt,
        fileCount: job._count.files,
        totalMatches: job.totalMatches,
        searchWord: job.searchWord,
        replaceWord: job.replaceWord,
        wordPairs: job.wordPairs,
      };
      // Same pattern as statusJob: only surface the failure reason for FAILED jobs.
      if (job.status === 'FAILED' && job.errorMessage) {
        item.errorMessage = job.errorMessage;
      }
      return item;
    });

    // Empty list (not an error) when the user has no jobs yet.
    return res.status(200).json({ jobs: payload });
  } catch (err) {
    console.error('listJobs error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while listing jobs.' });
  }
}

module.exports = {
  uploadJob,
  searchJob,
  replaceJob,
  downloadJob,
  statusJob,
  listJobs,
};
