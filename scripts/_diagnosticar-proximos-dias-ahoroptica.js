#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: el bot le mostró a un cliente real "próximos
 * días con disponibilidad": 4 (viernes), 5 (sábado) y 6 (domingo) de sep —
 * pero ya se confirmó antes que el 5 y el 6 NO tienen ninguna hora real
 * configurada. Este script llama a la función REAL que usa el bot
 * (obtenerProximosDiasConDisponibilidad) para confirmar si el problema es
 * el motor real (bug de código) o que el modelo fabricó la lista sin
 * llamarlo (mismo patrón que otros bugs de hoy).
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-proximos-dias-ahoroptica.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { obtenerHorariosDisponibles, obtenerProximosDiasConDisponibilidad, obtenerHorasDisponiblesParaServicio, obtenerProximosDiasParaServicio } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso.nombre, '| id:', recurso.id, '| horizonteAgendaDias:', recurso.horizonteAgendaDias, '| anticipacionMinimaMin:', recurso.anticipacionMinimaMin, '| duracionCitaMinutos:', recurso.duracionCitaMinutos);

  const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const horarioSemanal = await prisma.horarioSemanal.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { diaSemana: 'asc' } });
  console.log('\n--- Calendario CONFIGURADO (fuente de verdad) ---');
  console.log('Horario semanal:');
  horarioSemanal.forEach((h) => console.log(`  ${NOMBRES_DIA[h.diaSemana]} (diaSemana=${h.diaSemana}): ${h.horaInicio}-${h.horaFin} | activo=${h.activo}`));
  const excepciones = await prisma.horarioExcepcion.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { fecha: 'asc' } });
  console.log('Excepciones de horario:');
  if (excepciones.length === 0) console.log('  (ninguna)');
  excepciones.forEach((e) => console.log(`  ${e.fecha}: ${e.horaInicio}-${e.horaFin}`));
  const bloqueos = await prisma.bloqueo.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { fechaInicio: 'asc' } });
  console.log('Bloqueos:');
  if (bloqueos.length === 0) console.log('  (ninguno)');
  bloqueos.forEach((b) => console.log(`  ${b.fechaInicio.toISOString()} a ${b.fechaFin.toISOString()} — ${b.motivo || 'sin motivo'}`));

  const servicio = await prisma.servicio.findFirst({ where: { empresaId: EMPRESA_ID, nombre: { contains: 'examen visual', mode: 'insensitive' } } });
  console.log('\nServicio "Evaluación examen visual":', servicio ? `id=${servicio.id} requiereProfesionalEspecifico=${servicio.requiereProfesionalEspecifico}` : 'NO ENCONTRADO');

  console.log('\n--- obtenerProximosDiasConDisponibilidad (por RECURSO directo) ---');
  const proximosPorRecurso = await obtenerProximosDiasConDisponibilidad(recurso.id, 7);
  proximosPorRecurso.forEach((d) => console.log(`${d.fecha}: ${JSON.stringify(d.horas)}`));
  if (proximosPorRecurso.length === 0) console.log('(vacío — ningún día próximo con disponibilidad)');

  if (servicio) {
    console.log('\n--- obtenerProximosDiasParaServicio (por SERVICIO, lo que realmente usa la herramienta consultar_proximos_dias_disponibles) ---');
    const proximosPorServicio = await obtenerProximosDiasParaServicio(servicio.id, 7, 30, servicio.requiereProfesionalEspecifico ? recurso.id : null);
    proximosPorServicio.forEach((d) => console.log(`${d.fecha}: ${JSON.stringify(d.horas)}`));
    if (proximosPorServicio.length === 0) console.log('(vacío — ningún día próximo con disponibilidad)');
  }

  console.log('\n--- Chequeo puntual día por día (4, 5, 6, 12, 26 de sep 2026) ---');
  for (const fecha of ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-12', '2026-09-26']) {
    const horas = await obtenerHorariosDisponibles(recurso.id, fecha);
    console.log(`${fecha}: ${JSON.stringify(horas)}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
