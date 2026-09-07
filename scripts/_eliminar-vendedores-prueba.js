#!/usr/bin/env node
// Uso puntual (2026-09-07): elimina 3 de los 4 Vendedor en producción,
// dejando solo "Rubén Admin" (admin@multidigital.cl). Confirma cada id +
// email exacto antes de borrar nada (aborta si algo no calza).
//
// EventoGestionVenta y RankingMensual tienen vendedorId OBLIGATORIO (bloquean
// el borrado si quedan filas) -- se borran primero, solo para el vendedor de
// prueba que las tiene. Empresa/DemoAsignada/Lead tienen vendedorId opcional,
// así que quedan sin vendedor asignado (no se borran).
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const A_ELIMINAR = [
  { id: '6720f7c1-0029-41ba-aa59-127b5d755259', email: 'ruben@multidigital.cl' },
  { id: 'ee8a7d42-a7bb-4830-8d4b-c9f125d44651', email: 'prueba-fase4-vendedor@multidigital.cl' },
  { id: '4c489384-7056-44e7-8b0f-6652297564c9', email: 'prueba-fase4-admin@multidigital.cl' },
];
const A_MANTENER = { id: '5de26f32-babf-49da-aeb7-69074d9e63f4', email: 'admin@multidigital.cl' };

async function main() {
  const mantener = await prisma.vendedor.findUnique({ where: { id: A_MANTENER.id } });
  if (!mantener || mantener.email !== A_MANTENER.email) {
    console.error('ABORTADO: el vendedor a mantener no calza como se esperaba.');
    process.exit(1);
  }

  for (const v of A_ELIMINAR) {
    const encontrado = await prisma.vendedor.findUnique({ where: { id: v.id } });
    if (!encontrado || encontrado.email !== v.email) {
      console.error(`ABORTADO: "${v.email}" no calza como se esperaba (id ${v.id}). No se borró nada de este vendedor.`);
      continue;
    }

    await prisma.$transaction([
      prisma.eventoGestionVenta.deleteMany({ where: { vendedorId: v.id } }),
      prisma.rankingMensual.deleteMany({ where: { vendedorId: v.id } }),
      prisma.horarioModalidadVendedor.deleteMany({ where: { vendedorId: v.id } }),
      prisma.vendedor.delete({ where: { id: v.id } }),
    ]);
    console.log(`Eliminado: ${encontrado.nombre} (${encontrado.email})`);
  }

  console.log('\nMantenido:', mantener.nombre, `(${mantener.email})`);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
