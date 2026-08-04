const { PrismaClient } = require('@prisma/client');

// Single shared PrismaClient for the whole process. Creating a new client per
// request would open a new connection pool each time and quickly exhaust the
// database's connection limit (especially on hosted Postgres like Neon).
const prisma = new PrismaClient();

module.exports = prisma;
