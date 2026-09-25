#!/usr/bin/env node
// Uso puntual: el botón "Sí, confirmo" no confirmó la cita de prueba creada
// por _crear-cita-prueba-botones-984084321-25sep.js -- hipótesis: hay más
// de un Cliente con telefono=56984084321 en Ahorróptica (número reusado en
// muchas sesiones de prueba anteriores) y el lookup por findFirst (sin
// orderBy) puede estar agarrando uno distinto al que tiene la Cita nueva.
// Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-clientes-duplicados-984084321-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56984084321';

async function main() {
  const clientes = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
    select: { id: true, nombre: true, creadoEn: true },
  });
  console.log(`${clientes.length} Cliente(s) con telefono=${TELEFONO} en Ahorróptica:\n`);
  for (const c of clientes) {
    const citas = await prisma.cita.findMany({
      where: { clienteId: c.id },
      select: { id: true, estado: true, confirmacionIntentos: true, fechaHoraInicio: true },
    });
    console.log(`- Cliente ${c.id} | "${c.nombre}" | creado ${c.creadoEn.toISOString()} | ${citas.length} cita(s):`);
    for (const cita of citas) {
      console.log(`    · ${cita.id} | estado=${cita.estado} | intentos=${cita.confirmacionIntentos} | ${cita.fechaHoraInicio.toISOString()}`);
    }
  }

  console.log('\n=== findFirst (el que usa server.js) devuelve: ===');
  const primero = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  console.log(primero ? `${primero.id} ("${primero.nombre}")` : 'ninguno');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
