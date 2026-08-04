const jwt = require('jsonwebtoken');

// Protects routes by requiring a valid JWT. We verify the token here (rather than
// in each controller) so that any protected route can simply mount this middleware
// and then trust req.user downstream.
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';

  // Expected format: "Bearer <token>".
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('authMiddleware error: JWT_SECRET is not set');
    return res.status(500).json({ error: 'Server auth is not configured.' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    // Attach the decoded payload ({ id, role, iat, exp }) so downstream handlers
    // know who is making the request.
    req.user = decoded;
    return next();
  } catch (err) {
    // Covers expired, malformed, or tampered tokens.
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = authMiddleware;
