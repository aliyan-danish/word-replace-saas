const prisma = require('../lib/prisma');

const VALID_ROLES = new Set(['USER', 'ADMIN']);
const VALID_SUBSCRIPTION_STATUSES = new Set(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELED']);

// True only for a real positive integer (rejects floats, 0, negatives, non-numbers).
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// monthlyJobLimit may be null (unlimited) or a positive integer.
function isValidMonthlyJobLimit(value) {
  return value === null || isPositiveInteger(value);
}

async function listPlans(req, res) {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { name: 'asc' },
    });
    return res.status(200).json({ plans });
  } catch (err) {
    console.error('listPlans error:', err);
    return res.status(500).json({ error: 'Something went wrong while listing plans.' });
  }
}

async function listUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        // Never select password. Subscription is optional — null for accounts without one.
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            plan: { select: { name: true } },
          },
        },
      },
    });

    const payload = users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      subscription: user.subscription
        ? {
            plan: user.subscription.plan.name,
            status: user.subscription.status,
            trialEndsAt: user.subscription.trialEndsAt
              ? user.subscription.trialEndsAt.toISOString()
              : null,
          }
        : null,
    }));

    return res.status(200).json({ users: payload });
  } catch (err) {
    console.error('listUsers error:', err);
    return res.status(500).json({ error: 'Something went wrong while listing users.' });
  }
}

async function updatePlan(req, res) {
  try {
    const { planId } = req.params;
    const body = req.body || {};

    const hasMonthly = Object.prototype.hasOwnProperty.call(body, 'monthlyJobLimit');
    const hasMaxFiles = Object.prototype.hasOwnProperty.call(body, 'maxFilesPerJob');
    const hasMaxBytes = Object.prototype.hasOwnProperty.call(body, 'maxUploadBytes');

    if (!hasMonthly && !hasMaxFiles && !hasMaxBytes) {
      return res.status(400).json({
        error:
          'Provide at least one of: monthlyJobLimit, maxFilesPerJob, maxUploadBytes.',
      });
    }

    const data = {};

    if (hasMonthly) {
      if (!isValidMonthlyJobLimit(body.monthlyJobLimit)) {
        return res.status(400).json({
          error: 'monthlyJobLimit must be null (unlimited) or a positive integer.',
        });
      }
      data.monthlyJobLimit = body.monthlyJobLimit;
    }

    if (hasMaxFiles) {
      if (!isPositiveInteger(body.maxFilesPerJob)) {
        return res.status(400).json({
          error: 'maxFilesPerJob must be a positive integer.',
        });
      }
      data.maxFilesPerJob = body.maxFilesPerJob;
    }

    if (hasMaxBytes) {
      if (!isPositiveInteger(body.maxUploadBytes)) {
        return res.status(400).json({
          error: 'maxUploadBytes must be a positive integer.',
        });
      }
      data.maxUploadBytes = body.maxUploadBytes;
    }

    const existing = await prisma.plan.findUnique({ where: { id: planId } });
    if (!existing) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    const plan = await prisma.plan.update({
      where: { id: planId },
      data,
    });

    return res.status(200).json(plan);
  } catch (err) {
    console.error('updatePlan error:', err);
    return res.status(500).json({ error: 'Something went wrong while updating the plan.' });
  }
}

async function updateUserSubscription(req, res) {
  try {
    const { userId } = req.params;
    const body = req.body || {};

    const hasPlanId = Object.prototype.hasOwnProperty.call(body, 'planId');
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');

    if (!hasPlanId && !hasStatus) {
      return res.status(400).json({
        error: 'Provide at least one of: planId, status.',
      });
    }

    const data = {};

    if (hasPlanId) {
      if (typeof body.planId !== 'string' || body.planId.trim() === '') {
        return res.status(400).json({ error: 'planId must be a non-empty string.' });
      }
      const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found.' });
      }
      data.planId = body.planId;
    }

    if (hasStatus) {
      if (typeof body.status !== 'string' || !VALID_SUBSCRIPTION_STATUSES.has(body.status)) {
        return res.status(400).json({
          error: 'status must be one of: TRIAL, ACTIVE, EXPIRED, CANCELED.',
        });
      }
      data.status = body.status;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!user.subscription) {
      return res.status(404).json({
        error: 'This user has no subscription to update.',
      });
    }

    const subscription = await prisma.subscription.update({
      where: { userId },
      data,
      include: { plan: true },
    });

    return res.status(200).json(subscription);
  } catch (err) {
    console.error('updateUserSubscription error:', err);
    return res
      .status(500)
      .json({ error: 'Something went wrong while updating the subscription.' });
  }
}

async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const body = req.body || {};
    const { role } = body;

    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'role must be "USER" or "ADMIN".' });
    }

    // Prevent an admin from demoting themselves and locking themselves out.
    if (req.user.id === userId && role === 'USER') {
      return res.status(400).json({
        error: 'You cannot remove your own admin access.',
      });
    }

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true },
    });

    return res.status(200).json(user);
  } catch (err) {
    console.error('updateUserRole error:', err);
    return res.status(500).json({ error: 'Something went wrong while updating the role.' });
  }
}

module.exports = {
  listPlans,
  listUsers,
  updatePlan,
  updateUserSubscription,
  updateUserRole,
};
