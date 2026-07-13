const { PrismaClient } = require('@prisma/client');

// Reutilizamos una sola instancia de PrismaClient en toda la app,
// en vez de crear una nueva conexión por request.
const prisma = new PrismaClient();

module.exports = prisma;
