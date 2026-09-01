#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: compara el horario REAL configurado de
 * Ahorróptica contra lo que el motor de disponibilidad (el mismo que usa
 * el bot) devuelve de verdad para los próximos 10 días — para confirmar o
 * descartar 2 reportes: (1) el bot ofrece días sin horario configurado,
 * (2) lo programado para viernes aparece como sábado.
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-disponibilidad-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { obtenerHorariosDisponibles, obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function sumarDiasISO(fechaISO, n) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().split('T')[0];
}

async function main() {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso.nombre, '| id:', recurso.id, '| duracionCitaMinutos:', recurso.duracionCitaMinutos);

  const horarios = await prisma.horarioSemanal.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { diaSemana: 'asc' } });
  console.log('\n--- Horario REAL configurado (ground truth) ---');
  const diasConHorarioActivo = new Set();
  for (const h of horarios) {
    console.log(`${NOMBRES_DIA[h.diaSemana]} (diaSemana=${h.diaSemana}): ${h.horaInicio}-${h.horaFin} | activo=${h.activo}`);
    if (h.activo) diasConHorarioActivo.add(h.diaSemana);
  }

  const hoyChileISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  console.log('\nHoy (Chile):', hoyChileISO);

  console.log('\n--- Próximos 10 días: diaSemana calculado vs. disponibilidad real devuelta ---');
  for (let i = 0; i < 10; i++) {
    const fechaISO = sumarDiasISO(hoyChileISO, i);
    const [anio, mes, dia] = fechaISO.split('-').map(Number);
    const diaSemanaCalculado = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
    const horas = await obtenerHorariosDisponibles(recurso.id, fechaISO);
    const deberiaTenerHorario = diasConHorarioActivo.has(diaSemanaCalculado);
    const alerta = (horas.length > 0 && !deberiaTenerHorario) ? '  <<< ALERTA: devuelve horas pero ese día NO tiene horario activo configurado' : '';
    console.log(`${fechaISO} (${NOMBRES_DIA[diaSemanaCalculado]}, diaSemana=${diaSemanaCalculado}) -> ${horas.length} horas: ${JSON.stringify(horas)}${alerta}`);
  }

  console.log('\n--- Lo que vería un cliente real preguntando "próximos días disponibles" ---');
  const proximosDias = await obtenerProximosDiasConDisponibilidad(recurso.id, 7);
  for (const d of proximosDias) {
    const [anio, mes, dia] = d.fecha.split('-').map(Number);
    const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
    console.log(`${d.fecha} (${NOMBRES_DIA[diaSemana]}): ${JSON.stringify(d.horas)}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
