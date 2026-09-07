#!/usr/bin/env node
// Uso puntual: lista los Vendedor existentes (sin passwordHash) -- para
// saber si hay una cuenta ADMIN utilizable en esta base. Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const vendedores = await prisma.vendedor.findMany({
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
    orderBy: { creadoEn: 'asc' },
  });
  console.log(`Total vendedores: ${vendedores.length}`);
  console.log(JSON.stringify(vendedores, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
