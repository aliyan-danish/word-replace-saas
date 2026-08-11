const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middlewares/auth.middleware');
const { register, login, getMe } = require('../controllers/auth.controller');

const router = express.Router();

// --- Strict auth rate limit (brute-force protection) ---
// Only on login/register — deliberately NOT on GET /me, which the Dashboard and
// AdminRoute call on every page load and would trip a 10/15m cap quickly.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(429).json({
      error: 'Too many requests, please try again later.',
    });
  },
});

// Routes are relative to the /auth mount point in index.js.
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
// Current user + subscription/limits. Reuses authMiddleware (same as /api/jobs/*)
// and getEnforcedSubscription so lazy trial expiry runs on visit alone.
router.get('/me', authMiddleware, getMe);

module.exports = router;
