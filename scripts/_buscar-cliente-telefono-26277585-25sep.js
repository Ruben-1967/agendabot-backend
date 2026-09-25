#!/usr/bin/env node
// Uso puntual: Diego (Ahorróptica) reportó un teléfono mal asignado a un
// cliente (56926277585) -- el panel bloquea la edición porque el Cliente ya
// tiene conversaciones (protección del 2026-09-22 contra el bug de
// duplicados). Busca el/los Cliente(s) con ese teléfono en Ahorróptica para
// confirmar el caso antes de corregir nada. Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_buscar-cliente-telefono-26277585-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56926277585';

async function main() {
  const clientes = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
    include: { _count: { select: { conversaciones: true, citas: true } } },
  });

  if (clientes.length === 0) {
    console.log(`No se encontró ningún Cliente con telefono=${TELEFONO} en Ahorróptica. Probando en TODAS las empresas...`);
    const enOtras = await prisma.cliente.findMany({
      where: { telefono: TELEFONO },
      include: { empresa: { select: { nombre: true } }, _count: { select: { conversaciones: true, citas: true } } },
    });
    for (const c of enOtras) {
      console.log(`- ${c.id} | "${c.nombre}" | empresa="${c.empresa.nombre}" | conversaciones=${c._count.conversaciones} | citas=${c._count.citas}`);
    }
    return;
  }

  for (const c of clientes) {
    console.log(`Cliente ${c.id}`);
    console.log(`  nombre: ${c.nombre}`);
    console.log(`  telefono: ${c.telefono}`);
    console.log(`  rut: ${c.rut || '(sin rut)'}`);
    console.log(`  conversaciones: ${c._count.conversaciones}`);
    console.log(`  citas: ${c._count.citas}`);

    const citasPendientes = await prisma.cita.findMany({
      where: { clienteId: c.id, estado: 'PENDIENTE' },
      select: { id: true, fechaHoraInicio: true, confirmacionIntentos: true },
      orderBy: { fechaHoraInicio: 'asc' },
    });
    if (citasPendientes.length > 0) {
      console.log(`  citas PENDIENTE (van a seguir mandando recordatorios a este teléfono hasta que se corrija):`);
      for (const cita of citasPendientes) {
        console.log(`    · ${cita.id} | ${cita.fechaHoraInicio.toISOString()} | intentos=${cita.confirmacionIntentos}`);
      }
    }
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
