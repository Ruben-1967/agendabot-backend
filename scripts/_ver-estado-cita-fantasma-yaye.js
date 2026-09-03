#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: estado actual de la clienta real "yaye"
 * (Ayelén Avilez, +56940369712) que quedó con una cita fantasma por el bug
 * de agendar_cita del 2026-09-01 — para saber si Ahorróptica ya la
 * contactó/resolvió, o si el pendiente sigue exactamente igual.
 *
 * Uso (Render Shell): node scripts/_ver-estado-cita-fantasma-yaye.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const cliente = await prisma.cliente.findFirst({
    where: { telefono: { contains: '940369712' } },
    include: {
      citas: { orderBy: { fechaHoraInicio: 'asc' }, include: { servicio: true, recurso: true } },
      empresa: { select: { nombre: true } },
    },
  });

  if (!cliente) {
    console.log('No se encontró ningún cliente con ese teléfono.');
    return;
  }

  console.log('Cliente:', cliente.nombre, '| empresa:', cliente.empresa.nombre, '| id:', cliente.id);
  console.log(`\nCitas (${cliente.citas.length}):`);
  cliente.citas.forEach((c) =>
    console.log(`  ${c.fechaHoraInicio.toISOString()} | ${c.estado} | ${c.servicio?.nombre || 'sin servicio'} | ${c.recurso?.nombre || 'sin profesional'} | id=${c.id}`)
  );
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
