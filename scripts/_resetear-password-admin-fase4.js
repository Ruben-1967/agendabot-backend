#!/usr/bin/env node
// Uso puntual: resetea la contraseña de la cuenta de prueba
// "[PRUEBA] Admin Fase4" (prueba-fase4-admin@multidigital.cl) en la base
// de Staging, para poder probar el panel de vendedores reorganizado.
// Es una cuenta de prueba aislada -- seguro resetearla acá.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

const EMAIL = 'prueba-fase4-admin@multidigital.cl';
const NUEVA_PASSWORD = 'staging-fase4-2026';

async function main() {
  const vendedor = await prisma.vendedor.findUnique({ where: { email: EMAIL } });
  if (!vendedor) {
    console.error('No se encontró el vendedor:', EMAIL);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(NUEVA_PASSWORD, 10);
  await prisma.vendedor.update({ where: { id: vendedor.id }, data: { passwordHash } });

  console.log(`Contraseña reseteada para ${EMAIL}.`);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
