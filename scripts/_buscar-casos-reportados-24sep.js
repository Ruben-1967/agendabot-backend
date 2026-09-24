#!/usr/bin/env node
// Ahorróptica reportó 2 situaciones hoy (2026-09-24):
//   1. "sigue respondiendo a pesar de que ya finalizó la conversación"
//   2. "sigue pidiendo confirmar con un 'Si o No' textual y no por botones"
// El caso 2 ya se identificó (Carlos Silva, cita 25-sep 09:30 -- ver
// server.js:1275, el regex de confirmación exige match exacto). Este
// script busca el caso 1: cualquier conversación de Ahorróptica con
// actividad HOY que muestre el patrón del pantallazo (mensaje de
// contención de Coexistence apareciendo después de que la conversación
// parecía haber terminado). Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_buscar-casos-reportados-24sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TEXTO_CONTENCION = 'Estamos revisando tu consulta, en breve te respondemos';

async function main() {
  // 1. Conversaciones con actividad HOY (últimas 24h) para Ahorróptica.
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, actualizadoEn: { gte: desde } },
    orderBy: { actualizadoEn: 'desc' },
  });
  console.log(`${conversaciones.length} conversación(es) con actividad en las últimas 24h.\n`);

  // 2. Carlos Silva (caso 2, ya identificado) -- confirmar que aparece.
  const casoCarlos = conversaciones.find((c) => {
    const mensajes = Array.isArray(c.mensajes) ? c.mensajes : [];
    return mensajes.some((m) => /9:30|09:30/.test(m.contenido || ''));
  });
  if (casoCarlos) {
    console.log(`✅ Caso "Carlos Silva" (cita 09:30) encontrado: teléfono ${casoCarlos.telefono}\n`);
  }

  // 3. Buscar el patrón del caso 1: contención aparece HOY, en una
  // conversación cuyo mensaje ANTERIOR a la contención ya sonaba a cierre
  // (despedida) -- imprime cada conversación con contención hoy junto a
  // los mensajes previos, para que se pueda leer el contexto completo.
  console.log('='.repeat(70));
  console.log('Conversaciones con mensaje de contención en las últimas 24h:');
  console.log('='.repeat(70));

  let encontroAlguna = false;
  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    const idxContencion = mensajes.findIndex((m) => m.contenido === TEXTO_CONTENCION && new Date(m.timestamp) >= desde);
    if (idxContencion === -1) continue;

    encontroAlguna = true;
    console.log(`\n--- Teléfono ${conv.telefono} | pausadaPorHumanoEn: ${conv.pausadaPorHumanoEn} ---`);
    const desdeIdx = Math.max(0, idxContencion - 6);
    for (let i = desdeIdx; i < mensajes.length; i++) {
      const m = mensajes[i];
      const marca = i === idxContencion ? ' <-- CONTENCIÓN' : '';
      console.log(`  [${m.rol}] ${m.timestamp} | "${(m.contenido || '').slice(0, 100)}"${marca}`);
    }
  }
  if (!encontroAlguna) {
    console.log('Ninguna conversación con contención en las últimas 24h.');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
