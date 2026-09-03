#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: lista todos los Cliente de Alejandro Barber
 * (la cuenta real, 18ba4ab2-17bd-4044-b6f7-2859917de126) con lo que tiene
 * asociado cada uno (citas, ventas, fichas clínicas, lista de espera,
 * pedidos, conversaciones) — para saber exactamente qué se va a borrar
 * antes de eliminar los clientes de prueba.
 *
 * Uso (Render Shell): node scripts/_ver-clientes-prueba-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = '18ba4ab2-17bd-4044-b6f7-2859917de126';

async function main() {
  const clientes = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID },
    select: {
      id: true, nombre: true, telefono: true, creadoEn: true,
      _count: { select: { citas: true, ventas: true, atencionesClinicas: true, listaEspera: true, pedidos: true, conversaciones: true } },
    },
    orderBy: { creadoEn: 'asc' },
  });

  if (clientes.length === 0) {
    console.log('Alejandro Barber no tiene ningún cliente registrado.');
    return;
  }

  console.log(`${clientes.length} cliente(s) en Alejandro Barber:\n`);
  let totales = { citas: 0, ventas: 0, atencionesClinicas: 0, listaEspera: 0, pedidos: 0, conversaciones: 0 };
  clientes.forEach((c) => {
    console.log(`- ${c.nombre} | tel=${c.telefono || '—'} | creado=${c.creadoEn.toISOString().slice(0, 10)} | id=${c.id}`);
    console.log(`  citas=${c._count.citas} ventas=${c._count.ventas} fichas=${c._count.atencionesClinicas} listaEspera=${c._count.listaEspera} pedidos=${c._count.pedidos} conversaciones=${c._count.conversaciones}`);
    for (const k of Object.keys(totales)) totales[k] += c._count[k];
  });

  console.log('\nTotales:', totales);
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
