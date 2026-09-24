#!/usr/bin/env node
// Uso puntual: caso reportado por Ahorróptica (2026-09-24) -- "sigue
// respondiendo a pesar de que ya finalizó la conversación". Imprime el
// historial completo de esta conversación puntual para ver exactamente
// qué pasó. Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_inspeccionar-conversacion-964693851.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56964693851';

async function main() {
  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });
  if (!conversacion) {
    console.log(`No se encontró conversación con teléfono ${TELEFONO} en Ahorróptica -- probando sin el 56 inicial...`);
    const alt = await prisma.conversacion.findFirst({
      where: { empresaId: EMPRESA_ID, telefono: { contains: '964693851' } },
    });
    if (!alt) {
      console.log('Tampoco se encontró con ese formato. Revisar el teléfono.');
      return;
    }
    return imprimir(alt);
  }
  imprimir(conversacion);
}

function imprimir(conversacion) {
  console.log(`Teléfono guardado: ${conversacion.telefono}`);
  console.log(`pausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn}`);
  console.log(`contencionEnviadaEn: ${conversacion.contencionEnviadaEn}`);
  console.log(`alertaUrgenteEnviadaEn: ${conversacion.alertaUrgenteEnviadaEn}`);
  console.log(`reservaEnCurso: ${JSON.stringify(conversacion.reservaEnCurso)}`);
  console.log(`actualizadoEn: ${conversacion.actualizadoEn}`);

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  console.log(`\n${mensajes.length} mensaje(s) totales:\n`);
  for (const m of mensajes) {
    console.log(`[${m.rol}] ${m.timestamp} | "${m.contenido}"`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
