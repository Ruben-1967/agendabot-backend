#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA: Ahorróptica reportó que citas agendadas por
 * el bot (ej. sábado 12 de sep 2026, 11:15) no aparecen en Tabla de citas.
 * Este script busca esa cita real y compara sus datos contra lo que
 * GET /agenda/citas calcula, para ver dónde se pierde.
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-cita-no-aparece-tabla.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC } = require('../src/lib/horaChile');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const FECHA_REPORTADA = '2026-09-12';

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) { console.log('No se encontró la empresa con ese id.'); return; }
  console.log('Empresa:', empresa.nombre);

  const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: EMPRESA_ID } });
  console.log('\nRecursos de la empresa:');
  recursos.forEach((r) => console.log(`- id=${r.id} nombre="${r.nombre}" tipo=${r.tipo}`));

  console.log('\n--- Últimas 15 citas de la empresa (cualquier fecha), más reciente primero ---');
  const ultimasCitas = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID },
    include: { cliente: { select: { nombre: true, telefono: true } } },
    orderBy: { creadoEn: 'desc' },
    take: 15,
  });
  ultimasCitas.forEach((c) => {
    console.log(`- id=${c.id} | cliente=${c.cliente?.nombre} (${c.cliente?.telefono}) | fechaHoraInicio(UTC)=${c.fechaHoraInicio.toISOString()} | recursoAgendableId=${c.recursoAgendableId} | estado=${c.estado} | creadoEn=${c.creadoEn.toISOString()}`);
  });

  console.log(`\n--- Rango que usa GET /agenda/citas para fecha=${FECHA_REPORTADA} ---`);
  const inicioDia = horaChileAFechaUTC(FECHA_REPORTADA, '00:00');
  const finDia = horaChileAFechaUTC(FECHA_REPORTADA, '23:59');
  console.log(`gte=${inicioDia.toISOString()} lte=${finDia.toISOString()}`);

  const citasEnRangoTodosLosRecursos = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID, fechaHoraInicio: { gte: inicioDia, lte: finDia } },
    include: { cliente: { select: { nombre: true } } },
  });
  console.log(`\nCitas en ese rango, TODOS los recursos de la empresa: ${citasEnRangoTodosLosRecursos.length}`);
  citasEnRangoTodosLosRecursos.forEach((c) => {
    console.log(`- ${c.cliente?.nombre} | fechaHoraInicio(UTC)=${c.fechaHoraInicio.toISOString()} | recursoAgendableId=${c.recursoAgendableId} | estado=${c.estado}`);
  });

  // Búsqueda amplia extra por si el problema es de fecha corrida: +-2 días
  console.log('\n--- Búsqueda amplia +-2 días por si la fecha quedó corrida ---');
  const desdeAmplio = new Date(inicioDia.getTime() - 2 * 24 * 60 * 60 * 1000);
  const hastaAmplio = new Date(finDia.getTime() + 2 * 24 * 60 * 60 * 1000);
  const citasAmplio = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID, fechaHoraInicio: { gte: desdeAmplio, lte: hastaAmplio } },
    include: { cliente: { select: { nombre: true } } },
    orderBy: { fechaHoraInicio: 'asc' },
  });
  citasAmplio.forEach((c) => {
    console.log(`- ${c.cliente?.nombre} | fechaHoraInicio(UTC)=${c.fechaHoraInicio.toISOString()} | recursoAgendableId=${c.recursoAgendableId} | estado=${c.estado}`);
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
