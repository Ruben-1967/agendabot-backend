#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: trae la conversación completa de la clienta
 * real "yaye" (+56940369712, Ahorróptica) para saber qué servicio/día pidió
 * y qué le confirmó el bot — la Cita real nunca se creó (bug de cita
 * fantasma, 2026-09-01), así que el único registro de lo que pidió está en
 * el historial de mensajes.
 *
 * Uso (Render Shell): node scripts/_ver-conversacion-cita-fantasma-yaye.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const conversacion = await prisma.conversacion.findFirst({
    where: { telefono: { contains: '940369712' } },
    orderBy: { creadoEn: 'desc' },
  });

  if (!conversacion) {
    console.log('No se encontró ninguna conversación con ese teléfono.');
    return;
  }

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  console.log(`Conversación ${conversacion.id} — ${mensajes.length} mensaje(s):\n`);
  mensajes.forEach((m) => console.log(`[${m.timestamp}] ${m.rol}: ${m.contenido}`));
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
