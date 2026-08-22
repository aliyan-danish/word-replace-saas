const prisma = require('../lib/prisma');

// Public catalog of current plan limits. No auth — the landing page is public
// and must not call /api/admin/plans. Only the fields a visitor needs to see.
async function listPublicPlans(req, res) {
  try {
    const rows = await prisma.plan.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        monthlyJobLimit: true,
        maxFilesPerJob: true,
        maxUploadBytes: true,
      },
    });
    return res.status(200).json({ plans: rows });
  } catch (err) {
    console.error('listPublicPlans error:', err);
    return res.status(500).json({ error: 'Something went wrong while listing plans.' });
  }
}

module.exports = { listPublicPlans };
