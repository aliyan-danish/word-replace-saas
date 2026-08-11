const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
// Shared subscription helpers. createTrialSubscription backs registration; getEnforcedSubscription
// (reused by the upload check) also drives the lazy expiry so /me reflects it too.
const {
  createTrialSubscription,
  getEnforcedSubscription,
  PRO_PLAN_MISSING,
} = require('../lib/subscription');

// Cost factor for bcrypt. 10 is a sensible default balancing security and speed.
const SALT_ROUNDS = 10;
// Tokens are valid for 7 days, per the auth spec.
const TOKEN_EXPIRY = '7d';

// Minimal manual validation keeps the dependency surface small. We only need to
// reject empty/non-string email or password here; deeper format checks can come later.
function getMissingCredentialError(email, password) {
  if (typeof email !== 'string' || email.trim() === '') {
    return 'Email is required.';
  }
  if (typeof password !== 'string' || password === '') {
    return 'Password is required.';
  }
  return null;
}

async function register(req, res) {
  try {
    const { email, password } = req.body || {};

    const validationError = getMissingCredentialError(email, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      // 409 Conflict: the email is already taken.
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Anchor the trial window to a single registration timestamp so the user row and
    // its subscription agree on "now" (trialEndsAt = now + 7 days).
    const now = new Date();

    // Interactive transaction: user + subscription are created atomically via the shared
    // helper. If the PRO plan is missing or the subscription insert fails, the whole thing
    // rolls back so we never persist a user with no subscription.
    const { user, subscription } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          // role defaults to USER in the Prisma schema; set explicitly for clarity.
          role: 'USER',
        },
      });

      const sub = await createTrialSubscription(tx, createdUser.id, now);
      return { user: createdUser, subscription: sub };
    });

    // Never return the password hash to the client. Subscription summary is included so
    // the trial creation can be verified directly from the response (no Prisma Studio needed).
    return res.status(201).json({
      id: user.id,
      email: user.email,
      subscription: {
        plan: 'PRO',
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PRO_PLAN_MISSING) {
      console.error('register error: PRO plan not found — run the seed script (npm run seed)');
      return res.status(500).json({
        error: 'Subscription plans are not configured. Run the seed script (npm run seed) to create the FREE and PRO plans.',
      });
    }
    console.error('register error:', err);
    return res.status(500).json({ error: 'Something went wrong while registering.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    const validationError = getMissingCredentialError(email, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Use a single generic message for both "no such user" and "wrong password"
    // so we don't leak which emails are registered.
    const invalidCredentials = () =>
      res.status(401).json({ error: 'Invalid credentials.' });

    if (!user) {
      return invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return invalidCredentials();
    }

    // JWT_SECRET must come from the environment; never hardcode secrets.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('login error: JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server auth is not configured.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      secret,
      { expiresIn: TOKEN_EXPIRY }
    );

    return res.status(200).json({ token });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Something went wrong while logging in.' });
  }
}

async function getMe(req, res) {
  try {
    const userId = req.user.id;

    // JWT payload only has id/role — load email from the DB for the Account page.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Same helper as upload: backfills missing subscriptions and lazily flips a past-due
    // TRIAL to EXPIRED, so visiting /me alone is enough to surface expiry.
    const subscription = await getEnforcedSubscription(userId, new Date());
    const plan = subscription.plan;

    return res.status(200).json({
      id: user.id,
      email: user.email,
      // Role comes from the DB (not the JWT) so a demotion is visible after refresh
      // without waiting for the token to expire — AdminRoute / Dashboard use this.
      role: user.role,
      subscription: {
        plan: plan.name,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt
          ? subscription.trialEndsAt.toISOString()
          : null,
        currentPeriodEnd: subscription.currentPeriodEnd
          ? subscription.currentPeriodEnd.toISOString()
          : null,
      },
      limits: {
        monthlyJobLimit: plan.monthlyJobLimit,
        maxFilesPerJob: plan.maxFilesPerJob,
        maxUploadBytes: plan.maxUploadBytes,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PRO_PLAN_MISSING) {
      console.error('getMe error: PRO plan not found — run the seed script (npm run seed)');
      return res.status(500).json({
        error: 'Subscription plans are not configured. Run the seed script (npm run seed) to create the FREE and PRO plans.',
      });
    }
    console.error('getMe error:', err);
    return res.status(500).json({ error: 'Something went wrong while fetching your account.' });
  }
}

module.exports = { register, login, getMe };
