const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const requireAdmin = require('../middlewares/admin.middleware');
const {
  listPlans,
  listUsers,
  updatePlan,
  updateUserSubscription,
  updateUserRole,
} = require('../controllers/admin.controller');

const router = express.Router();

// Routes are relative to the /api/admin mount point in index.js.
// Every route requires a valid JWT AND role === ADMIN (auth first, then admin gate).
router.get('/plans', authMiddleware, requireAdmin, listPlans);
router.get('/users', authMiddleware, requireAdmin, listUsers);
router.patch('/plans/:planId', authMiddleware, requireAdmin, updatePlan);
router.patch(
  '/users/:userId/subscription',
  authMiddleware,
  requireAdmin,
  updateUserSubscription
);
router.patch('/users/:userId/role', authMiddleware, requireAdmin, updateUserRole);

module.exports = router;
