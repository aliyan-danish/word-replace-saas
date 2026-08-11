// Admin gate. Must run AFTER authMiddleware so req.user ({ id, role, ... }) is set.
// Role enum values are USER | ADMIN (see prisma/schema.prisma).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

module.exports = requireAdmin;
