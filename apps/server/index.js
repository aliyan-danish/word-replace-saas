const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const jobsRoutes = require('./routes/jobs.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// Railway (and any reverse proxy) sets X-Forwarded-For. Trust exactly one hop so
// express-rate-limit can use the real client IP. Do not use `true` — that trusts
// every proxy in the chain and lets a client spoof X-Forwarded-For.
app.set('trust proxy', 1);

// --- 1. Helmet: secure HTTP response headers (sensible defaults) ---
// One deliberate override: Cross-Origin-Resource-Policy defaults to "same-origin",
// which would block the Vite frontend (localhost:5173) from reading API responses
// and download blobs served from localhost:5000 (different origin). Everything else
// stays on Helmet's defaults. Content-Disposition on downloads is unaffected.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// --- 3. CORS: allow only the frontend origin (not *) ---
// FRONTEND_URL lets production swap origins without a code change.
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(
  cors({
    origin: frontendUrl,
  })
);

app.use(express.json());

// Shared JSON 429 body so rate-limit responses stay consistent with the rest of the API
// (express-rate-limit's default is plain text, not JSON).
function rateLimitHandler(req, res /*, next, options */) {
  return res.status(429).json({
    error: 'Too many requests, please try again later.',
  });
}

// --- 2b. Generous limiter: safety net for all /api/* routes ---
// Auth login/register use a stricter limiter (mounted on those routes in auth.routes.js).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes (register/login) are grouped under /auth per the RESTful-by-resource convention.
app.use('/auth', authRoutes);

// Job routes (file upload, and later scan/replace/download) grouped under /api/jobs.
app.use('/api/jobs', apiLimiter, jobsRoutes);

// Admin-only routes (user list, plan/subscription/role management). Each handler
// is also gated by authMiddleware + requireAdmin inside the router.
app.use('/api/admin', apiLimiter, adminRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
