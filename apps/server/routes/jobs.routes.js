const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { uploadSingleFile } = require('../middlewares/upload.middleware');
const {
  uploadJob,
  searchJob,
  replaceJob,
  downloadJob,
  statusJob,
  listJobs,
} = require('../controllers/jobs.controller');

const router = express.Router();

// Routes are relative to the /api/jobs mount point in index.js.
//
// NOTE on architecture: the project convention is to offload heavy work (unzipping,
// scanning, replacing) to a BullMQ worker rather than doing it in the request. This
// endpoint parses the upload inline because it is tightly bounded (<=10MB, <=100 files),
// so it stays fast. The heavier scan/replace steps should still be queued per that rule.
//
// Middleware order matters: authenticate first (so unauthenticated users never reach
// multer/file parsing), then parse the single "file" field, then run the controller.
// List the caller's own jobs (collection route). This bare "/" path can't be shadowed
// by the "/:jobId/..." routes below — those all require an extra path segment — so
// ordering is safe. Returns { jobs: [] } when there are none.
router.get('/', authMiddleware, listJobs);

router.post('/upload', authMiddleware, uploadSingleFile, uploadJob);

// Read-only occurrence count. JSON body is parsed by the global express.json() in
// index.js, so no multer here -- just auth + the controller. Safe to re-run any time.
router.post('/:jobId/search', authMiddleware, searchJob);

// Confirm/replace: validates + enqueues a BullMQ job and returns 202 immediately.
// The heavy replace work runs in the separate worker process (workers/replace.worker.js).
router.post('/:jobId/replace', authMiddleware, replaceJob);

// Lightweight status poll so the client can watch a REPLACING job flip to
// COMPLETED or FAILED. Read-only, same auth + ownership pattern.
router.get('/:jobId/status', authMiddleware, statusJob);

// Download the replaced files as a zip. Only valid once the job is COMPLETED.
// Streams a real application/zip attachment on success; errors stay clean JSON.
router.get('/:jobId/download', authMiddleware, downloadJob);

module.exports = router;
