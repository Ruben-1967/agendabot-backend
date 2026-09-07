#!/usr/bin/env node
// Uso puntual: lista Vendedor con cuánto tienen asociado (para saber si es
// seguro borrarlos sin perder datos reales). Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const vendedores = await prisma.vendedor.findMany({
    select: {
      id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true,
      _count: {
        select: {
          demosCreadas: true, empresasConvertidas: true, eventosGestion: true,
          rankingMensual: true, leads: true, horariosModalidad: true,
        },
      },
    },
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
