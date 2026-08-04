const path = require('path');
const AdmZip = require('adm-zip');
const prisma = require('../lib/prisma');
const { replaceQueue } = require('../lib/queue');
// Search still runs inline (read-only + cheap); it shares the regex builder with the
// replace worker via this module so the two can never diverge.
const { buildSearchRegex } = require('../lib/textReplace');

// Hard cap on how many .txt files we accept out of a single archive. Keeps a job
// bounded and prevents a huge archive from creating thousands of rows in one request.
const MAX_FILES_PER_ZIP = 100;

// Decide whether a zip entry is a real .txt file we should keep, filtering out
// directories and OS/editor junk (macOS resource forks, .DS_Store, dotfiles).
function isWantedTxtEntry(entry) {
  if (entry.isDirectory) return false;

  const entryName = entry.entryName; // full path within the archive, forward-slashed
  if (entryName.startsWith('__MACOSX/')) return false;

  const base = path.posix.basename(entryName);
  if (base === '.DS_Store') return false;
  if (base.startsWith('.')) return false; // skip hidden files like ._foo or .gitkeep

  return base.toLowerCase().endsWith('.txt');
}

// Turn a .zip buffer into a list of { filename, content, size }.
// Throws a plain Error with a user-safe message on invalid/empty archives.
function extractTxtFilesFromZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ZipError('The uploaded .zip file is invalid or corrupted.');
  }

  const txtEntries = zip.getEntries().filter(isWantedTxtEntry);

  if (txtEntries.length === 0) {
    throw new ZipError('The .zip file contains no .txt files.');
  }
  if (txtEntries.length > MAX_FILES_PER_ZIP) {
    throw new ZipError(
      `The .zip contains ${txtEntries.length} .txt files, which exceeds the limit of ${MAX_FILES_PER_ZIP}.`
    );
  }

  return txtEntries.map((entry) => {
    const raw = entry.getData(); // decompressed bytes for this entry
    return {
      filename: path.posix.basename(entry.entryName),
      content: raw.toString('utf8'),
      size: raw.length,
    };
  });
}

// Signals a client-fixable problem with the zip; mapped to HTTP 400 in the handler.
class ZipError extends Error {}

async function uploadJob(req, res) {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'No file uploaded. Send a file in the "file" field.' });
    }

    const { originalname, buffer } = req.file;
    const isZip = path.extname(originalname).toLowerCase() === '.zip';

    // Build the list of files to persist. Heavy work is intentionally bounded here
    // (<=10MB upload, <=100 files) so it stays cheap; see the note in the route file.
    let files;
    if (isZip) {
      files = extractTxtFilesFromZip(buffer);
    } else {
      files = [
        {
          filename: originalname,
          content: buffer.toString('utf8'),
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

    // 1. Validate the word: must be a non-empty string once trimmed.
    if (typeof body.word !== 'string' || body.word.trim() === '') {
      return res
        .status(400)
        .json({ error: 'A non-empty "word" string is required.' });
    }

    const word = body.word.trim();
    // Normalize optional toggles to real booleans so the echoed response is clean.
    const caseSensitive = Boolean(body.caseSensitive);
    const wholeWord = Boolean(body.wholeWord);

    // 2. Fetch the job with its files. We scope ownership after fetching so we can
    // return an identical 404 whether the job is missing or owned by someone else
    // (never reveal that another user's job exists).
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { files: true },
    });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // 3 & 4. Build the pattern via the shared helper (see buildSearchRegex).
    const regex = buildSearchRegex(word, { caseSensitive, wholeWord });

    // 5. Count occurrences per file. This endpoint never writes to the DB (req. 6),
    // so it can be re-run freely as the user tweaks the word or toggles.
    let totalOccurrences = 0;
    const files = job.files.map((file) => {
      const occurrences = file.content.match(regex)?.length ?? 0;
      totalOccurrences += occurrences;
      return { id: file.id, filename: file.filename, occurrences };
    });

    return res.status(200).json({
      jobId: job.id,
      word,
      caseSensitive,
      wholeWord,
      totalOccurrences,
      files,
    });
  } catch (err) {
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

    // 1. Validate word (non-empty after trim) and replacement (must be a string;
    // "" is valid and means "delete the word"; undefined/missing is a 400).
    if (typeof body.word !== 'string' || body.word.trim() === '') {
      return res
        .status(400)
        .json({ error: 'A non-empty "word" string is required.' });
    }
    if (typeof body.replacement !== 'string') {
      return res.status(400).json({
        error: 'A "replacement" string is required (use "" to delete the word).',
      });
    }

    const word = body.word.trim();
    const replacement = body.replacement;
    const caseSensitive = Boolean(body.caseSensitive);
    const wholeWord = Boolean(body.wholeWord);

    // 2. Ownership check — identical to searchJob: a missing job and someone else's
    // job both return the same generic 404. (No need to include files here; the worker
    // fetches them fresh when it runs.)
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // 3. The actual regex/replace work is heavy, so it's offloaded to the BullMQ
    // "replace-jobs" worker (per the architecture rule). We mark the job REPLACING
    // BEFORE enqueueing so a client polling /status never sees a stale COMPLETED/PENDING
    // between enqueue and the worker picking it up. Clear any prior errorMessage so a
    // retry of a previously-failed job starts clean.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'REPLACING', errorMessage: null },
    });

    // 4. Enqueue with just the ids + parameters. The worker re-reads file content from
    // the DB rather than trusting anything stale in the payload.
    await replaceQueue.add('replace', {
      jobId: job.id,
      word,
      replacement,
      caseSensitive,
      wholeWord,
    });

    // 5. Respond immediately; the client polls GET /:jobId/status for completion.
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
      zip.addFile(file.filename, Buffer.from(text, 'utf8'));
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
