const prisma = require('../lib/prisma');

// One-time (idempotent) seed of the two subscription plans. Uses upsert keyed on the
// unique `name` so re-running never creates duplicates and safely refreshes limits if
// they change. This is data-only setup — it does not touch users or subscriptions.
const PLANS = [
  {
    name: 'FREE',
    monthlyJobLimit: 5,
    maxFilesPerJob: 3,
    maxUploadBytes: 2097152, // 2 MB
  },
  {
    name: 'PRO',
    monthlyJobLimit: null, // unlimited
    maxFilesPerJob: 100,
    maxUploadBytes: 10485760, // 10 MB
  },
];

async function main() {
  for (const plan of PLANS) {
    const result = await prisma.plan.upsert({
      where: { name: plan.name },
      update: {
        monthlyJobLimit: plan.monthlyJobLimit,
        maxFilesPerJob: plan.maxFilesPerJob,
        maxUploadBytes: plan.maxUploadBytes,
      },
      create: plan,
    });
    console.log(`Seeded plan: ${result.name} (id: ${result.id})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
