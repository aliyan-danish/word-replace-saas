const path = require('path');
const multer = require('multer');

// 10MB cap on the raw upload. Applies to the single .txt or the .zip archive itself.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// We accept a .txt or a .zip. We validate BOTH the extension and the mimetype so a
// mislabeled file is rejected. Mimetypes vary by client, so each extension maps to a
// small allowlist that also tolerates the generic "application/octet-stream" that many
// clients (including curl in some configs) send for binary/unknown uploads.
const ALLOWED_MIME_BY_EXT = {
  '.txt': ['text/plain', 'application/octet-stream'],
  '.zip': [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
    'multipart/x-zip',
    'application/octet-stream',
  ],
};

// Storing in memory (no disk writes) keeps uploads ephemeral; the text is persisted to
// Postgres via Prisma in the controller instead of ever hitting the filesystem.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED_MIME_BY_EXT[ext];

  if (!allowedMimes) {
    // Reject on extension first with a clear, user-facing reason.
    return cb(new UploadValidationError('Only .txt or .zip files are allowed.'));
  }
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(
      new UploadValidationError(
        `File type mismatch: "${file.mimetype}" is not valid for a ${ext} file.`
      )
    );
  }
  return cb(null, true);
}

// Custom error type so the wrapper below can distinguish our validation failures
// (bad type) from multer's built-in errors (e.g. size limit) and from unexpected ones.
class UploadValidationError extends Error {}

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter,
});

// Wraps `upload.single('file')` so multer's errors become clean 400 JSON responses
// instead of bubbling up as unhandled errors. Anything unexpected is passed to next().
function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      return next();
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds the 10MB size limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res
          .status(400)
          .json({ error: 'Upload exactly one file in the "file" field.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    if (err instanceof UploadValidationError) {
      return res.status(400).json({ error: err.message });
    }

    // Unknown error: don't leak details, hand off to the generic handler.
    return next(err);
  });
}

module.exports = { uploadSingleFile };
