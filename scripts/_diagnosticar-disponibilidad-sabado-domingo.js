#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: compara la disponibilidad REAL de
 * Ahorróptica para sábado 5 y domingo 6 de sep 2026 contra lo que el bot
 * le mostró a un cliente real (mismos horarios exactos en ambos días,
 * sospechosamente idénticos — hace pensar que el domingo se inventó en vez
 * de consultarse).
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-disponibilidad-sabado-domingo.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { obtenerHorariosDisponibles } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso.nombre, '| id:', recurso.id);

  const horarios = await prisma.horarioSemanal.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { diaSemana: 'asc' } });
  const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  console.log('\n--- Horario semanal configurado ---');
  horarios.forEach((h) => console.log(`${NOMBRES_DIA[h.diaSemana]}: ${h.horaInicio}-${h.horaFin} | activo=${h.activo}`));

  const excepciones = await prisma.horarioExcepcion.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { fecha: 'asc' } });
  console.log('\n--- Excepciones de horario cargadas ---');
  if (excepciones.length === 0) console.log('(ninguna)');
  excepciones.forEach((e) => console.log(`${e.fecha}: ${e.horaInicio}-${e.horaFin}`));

  console.log('\n--- Disponibilidad REAL (motor real, mismo que usa el bot) ---');
  for (const fecha of ['2026-09-05', '2026-09-06']) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
    const horas = await obtenerHorariosDisponibles(recurso.id, fecha);
    console.log(`${fecha} (${NOMBRES_DIA[diaSemana]}): ${JSON.stringify(horas)}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
