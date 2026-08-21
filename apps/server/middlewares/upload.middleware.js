const path = require('path');
const multer = require('multer');

// 10MB cap on the raw upload. Applies to a single supported file or the .zip itself.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Validate BOTH extension and mimetype so a mislabeled file is rejected. Mimetypes
// vary by client, so each extension maps to a small allowlist that also tolerates
// the generic "application/octet-stream" that many clients (including curl) send.
const ALLOWED_MIME_BY_EXT = {
  '.txt': ['text/plain', 'application/octet-stream'],
  '.html': ['text/html', 'application/octet-stream'],
  '.htm': ['text/html', 'application/octet-stream'],
  '.xml': ['text/xml', 'application/xml', 'application/octet-stream'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'application/zip',
  ],
  '.zip': [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
    'multipart/x-zip',
    'application/octet-stream',
  ],
};

const ALLOWED_EXT_LABEL = '.txt, .html, .xml, .docx, or .zip';

// Storing in memory (no disk writes) keeps uploads ephemeral; the bytes are persisted
// to Postgres via Prisma in the controller instead of ever hitting the filesystem.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED_MIME_BY_EXT[ext];

  if (!allowedMimes) {
    return cb(new UploadValidationError(`Only ${ALLOWED_EXT_LABEL} files are allowed.`));
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

class UploadValidationError extends Error {}

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter,
});

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

    return next(err);
  });
}

module.exports = { uploadSingleFile };
