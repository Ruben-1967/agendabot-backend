#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: Ahorróptica no puede agendar un sobrecupo el
 * viernes 4 de sep a las 10:10/10:13 desde "Agregar cita" (panel), con el
 * error "Todos los profesionales tienen un conflicto de horario a esa
 * hora" — mientras que Alejandro Barber sí puede. Ahorróptica tiene
 * recursos con citas cada 15 min, Alejandro Barber cada 60 min.
 *
 * Imprime los recursos (profesionales) de Ahorróptica, su
 * duracionCitaMinutos, y todas las citas reales alrededor de esa hora ese
 * día — para ver si el "conflicto" es real (agenda llena) o un bug de la
 * lógica de tieneConflicto()/candidatos en POST /agenda/citas.
 *
 * Uso (Render Shell): node scripts/_diagnosticar-sobrecupo-ahoroptica.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC } = require('../src/lib/horaChile');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const FECHA = '2026-09-04';
const HORAS_A_PROBAR = ['10:10', '10:13'];

async function main() {
  const recursos = await prisma.recursoAgendable.findMany({
    where: { empresaId: EMPRESA_ID, tipo: 'profesional' },
  });
  console.log(`Recursos (profesionales) de Ahorróptica: ${recursos.length}`);
  recursos.forEach((r) =>
    console.log(`  ${r.nombre} | id=${r.id} | duracionCitaMinutos=${r.duracionCitaMinutos}`)
  );

  const inicioDia = horaChileAFechaUTC(FECHA, '00:00');
  const finDia = horaChileAFechaUTC(FECHA, '23:59');

  for (const recurso of recursos) {
    console.log(`\n--- Citas de "${recurso.nombre}" el ${FECHA} ---`);
    const citas = await prisma.cita.findMany({
      where: {
        recursoAgendableId: recurso.id,
        estado: { not: 'CANCELADA' },
        fechaHoraInicio: { gte: inicioDia, lte: finDia },
      },
      orderBy: { fechaHoraInicio: 'asc' },
      include: { cliente: { select: { nombre: true } } },
    });
    if (citas.length === 0) console.log('  (ninguna)');
    citas.forEach((c) => {
      const ini = c.fechaHoraInicio.toISOString().slice(11, 16);
      const fin = c.fechaHoraFin.toISOString().slice(11, 16);
      console.log(`  ${ini}-${fin} UTC | ${c.estado} | ${c.cliente?.nombre || '—'}`);
    });
  }

  console.log(`\n--- Simulación exacta de tieneConflicto() para cada hora/recurso ---`);
  for (const hora of HORAS_A_PROBAR) {
    const inicio = horaChileAFechaUTC(FECHA, hora);
    console.log(`\nHora ${hora} (Chile) -> ${inicio.toISOString()} UTC`);
    for (const recurso of recursos) {
      const fin = new Date(inicio.getTime() + (recurso.duracionCitaMinutos || 30) * 60 * 1000);
      const conflicto = await prisma.cita.findFirst({
        where: {
          recursoAgendableId: recurso.id,
          estado: { not: 'CANCELADA' },
          fechaHoraInicio: { lt: fin },
          fechaHoraFin: { gt: inicio },
        },
        include: { cliente: { select: { nombre: true } } },
      });
      console.log(
        `  ${recurso.nombre} (dur=${recurso.duracionCitaMinutos}min, fin tentativo=${fin.toISOString()}): ` +
        (conflicto
          ? `CONFLICTO con cita ${conflicto.fechaHoraInicio.toISOString()}-${conflicto.fechaHoraFin.toISOString()} (${conflicto.cliente?.nombre || '—'})`
          : 'libre')
      );
    }
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
