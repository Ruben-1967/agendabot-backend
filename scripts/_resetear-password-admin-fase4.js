#!/usr/bin/env node
// Uso puntual: resetea la contraseña de la cuenta de prueba
// "[PRUEBA] Admin Fase4" (prueba-fase4-admin@multidigital.cl) en la base
// de Staging. Genera una contraseña aleatoria nueva cada vez y la imprime
// -- nunca queda escrita en el código (a diferencia de la corrida
// anterior, cuyo valor fijo terminó expuesto en GitHub vía GitGuardian).
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

const EMAIL = 'prueba-fase4-admin@multidigital.cl';

async function main() {
  const vendedor = await prisma.vendedor.findUnique({ where: { email: EMAIL } });
  if (!vendedor) {
    console.error('No se encontró el vendedor:', EMAIL);
    process.exit(1);
  }

  const nuevaPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(nuevaPassword, 10);
  await prisma.vendedor.update({ where: { id: vendedor.id }, data: { passwordHash } });

  console.log(`Contraseña reseteada para ${EMAIL}: ${nuevaPassword}`);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
