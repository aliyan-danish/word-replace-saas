// One-time bootstrap: promote an existing user to ADMIN from the terminal.
// There is intentionally no HTTP endpoint for creating the first admin.
//
// Usage (from apps/server):
//   npm run make-admin -- someone@example.com
// The `--` is required so npm forwards the email to this script.

require('dotenv').config();
const prisma = require('../lib/prisma');

async function main() {
  const emailArg = process.argv[2];

  if (!emailArg || typeof emailArg !== 'string' || emailArg.trim() === '') {
    console.error('Usage: npm run make-admin -- someone@example.com');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}". Register them first, then re-run this script.`);
    process.exit(1);
  }

  if (user.role === 'ADMIN') {
    console.log(`Already ADMIN: id=${user.id} email=${user.email} role=${user.role}`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN' },
  });

  console.log(
    `Promoted to ADMIN: id=${updated.id} email=${updated.email} role=${updated.role}`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('make-admin failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
