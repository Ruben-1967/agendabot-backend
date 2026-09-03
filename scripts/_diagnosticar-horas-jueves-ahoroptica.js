#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: Ahorróptica reportó (2026-09-03, jueves) que
 * el bot le mostró a un cliente real disponibilidad completa para "hoy" —
 * 20 horarios entre 14:00 y 18:45 — para "Evaluación examen visual".
 * Confirma contra el motor real de disponibilidad si el jueves realmente
 * tiene atención configurada, y si esos horarios exactos son reales o
 * fabricados por el modelo.
 *
 * Uso (Render Shell): node scripts/_diagnosticar-horas-jueves-ahoroptica.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { obtenerHorariosDisponibles, obtenerHorasDisponiblesParaServicio, obtenerHorarioDelDia } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const FECHA = '2026-09-03'; // jueves

async function main() {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso.nombre, '| id:', recurso.id, '| duracionCitaMinutos:', recurso.duracionCitaMinutos);

  const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const [anio, mes, dia] = FECHA.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  console.log(`Fecha ${FECHA} = ${NOMBRES_DIA[diaSemana]} (diaSemana=${diaSemana})`);

  const horarioSemanal = await prisma.horarioSemanal.findMany({ where: { recursoAgendableId: recurso.id }, orderBy: { diaSemana: 'asc' } });
  console.log('\nHorario semanal configurado:');
  horarioSemanal.forEach((h) => console.log(`  ${NOMBRES_DIA[h.diaSemana]} (diaSemana=${h.diaSemana}): ${h.horaInicio}-${h.horaFin} | activo=${h.activo}`));

  const excepcion = await prisma.horarioExcepcion.findFirst({ where: { recursoAgendableId: recurso.id, fecha: FECHA } });
  console.log('\nExcepción para', FECHA, ':', excepcion ? `${excepcion.horaInicio}-${excepcion.horaFin}` : '(ninguna)');

  const bloqueDelDia = await obtenerHorarioDelDia(recurso.id, FECHA, diaSemana);
  console.log('\nobtenerHorarioDelDia (lo que realmente usa el motor):', JSON.stringify(bloqueDelDia));

  const horasReales = await obtenerHorariosDisponibles(recurso.id, FECHA);
  console.log('\nobtenerHorariosDisponibles (motor real, por recurso):', JSON.stringify(horasReales));

  const servicio = await prisma.servicio.findFirst({ where: { empresaId: EMPRESA_ID, nombre: { contains: 'examen visual', mode: 'insensitive' } } });
  if (servicio) {
    const horasServicio = await obtenerHorasDisponiblesParaServicio(servicio.id, FECHA, servicio.requiereProfesionalEspecifico ? recurso.id : null);
    console.log('\nobtenerHorasDisponiblesParaServicio (lo que realmente usa la herramienta consultar_disponibilidad):', JSON.stringify(horasServicio));
  } else {
    console.log('\nServicio "Evaluación examen visual" no encontrado.');
  }

  // El texto real del cliente mencionaba horarios de 14:00 a 18:45 cada 15 min
  const horasReportadas = ['14:00','14:15','14:30','14:45','15:00','15:15','15:30','15:45','16:00','16:15','16:30','16:45','17:00','17:15','17:30','17:45','18:00','18:15','18:30','18:45'];
  console.log('\nHoras que el bot le mostró al cliente:', JSON.stringify(horasReportadas));

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
