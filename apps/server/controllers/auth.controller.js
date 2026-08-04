const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

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

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        // role defaults to USER in the Prisma schema; set explicitly for clarity.
        role: 'USER',
      },
    });

    // Never return the password hash to the client.
    return res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
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

module.exports = { register, login };
