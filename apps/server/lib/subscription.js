const prisma = require('./prisma');

// Reverse-trial length: new (and backfilled) users get full PRO-level access for this
// many days before their subscription lazily flips to EXPIRED.
const TRIAL_DAYS = 7;

// Thrown when the PRO plan row is absent (seed never run). Callers translate this into a
// clear "run the seed script" 500 instead of a generic error, and — because it's thrown
// before/inside their transaction — user or job creation rolls back rather than persisting
// an account with no subscription.
const PRO_PLAN_MISSING = 'PRO_PLAN_MISSING';

// Create a reverse-trial subscription: PRO plan, TRIAL status, trialEndsAt = now + 7 days.
// `db` is a Prisma client OR an interactive-transaction client, so the SAME logic can run
// atomically inside register()'s transaction and standalone when backfilling on upload.
async function createTrialSubscription(db, userId, now = new Date()) {
  // During the trial the user gets full PRO limits (not FREE), so we attach PRO.
  const proPlan = await db.plan.findUnique({ where: { name: 'PRO' } });
  if (!proPlan) {
    throw new Error(PRO_PLAN_MISSING);
  }

  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  return db.subscription.create({
    data: {
      userId,
      planId: proPlan.id,
      status: 'TRIAL',
      trialEndsAt,
    },
    include: { plan: true },
  });
}

// Resolve the authoritative subscription (with its Plan) for a user at upload time:
//   1. Backfill a trial for pre-subscription accounts (graceful, not an error).
//   2. Lazily flip an expired TRIAL to EXPIRED with a real DB write — this is the single
//      source of truth for expiry, so no scheduled job is needed.
// The caller inspects the returned status to allow/deny and reads .plan for the limits.
async function getEnforcedSubscription(userId, now = new Date()) {
  let subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  // Edge case: old accounts created before subscriptions existed. Fold them in with the
  // same trial logic registration uses, rather than letting the upload break.
  if (!subscription) {
    try {
      subscription = await createTrialSubscription(prisma, userId, now);
    } catch (err) {
      // Two concurrent uploads could race to backfill; the unique userId constraint lets
      // exactly one win. If we lost that race, just read the row the winner created.
      if (err && err.code === 'P2002') {
        subscription = await prisma.subscription.findUnique({
          where: { userId },
          include: { plan: true },
        });
      } else {
        throw err;
      }
    }
  }

  // Lazy expiry: a TRIAL whose window has passed becomes EXPIRED right now.
  if (
    subscription.status === 'TRIAL' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt.getTime() < now.getTime()
  ) {
    subscription = await prisma.subscription.update({
      where: { userId },
      data: { status: 'EXPIRED' },
      include: { plan: true },
    });
  }

  return subscription;
}

module.exports = {
  TRIAL_DAYS,
  PRO_PLAN_MISSING,
  createTrialSubscription,
  getEnforcedSubscription,
};
