#!/usr/bin/env node
// Uso puntual: caso reportado por Diego (Ahorróptica, 2026-09-25) -- "el bot
// está enviando un mensaje que no corresponde". Imprime el historial completo
// de esta conversación puntual para ver exactamente qué se mandó. Solo lectura.
//
// USO:
//   node scripts/_inspeccionar-conversacion-962687089-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56962687089';

async function main() {
  let conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });
  if (!conversacion) {
    console.log(`No se encontró conversación con teléfono ${TELEFONO} en Ahorróptica -- probando sin el 56 inicial...`);
    conversacion = await prisma.conversacion.findFirst({
      where: { empresaId: EMPRESA_ID, telefono: { contains: '962687089' } },
    });
  }
  if (!conversacion) {
    console.log('Tampoco se encontró con ese formato. Buscando en TODAS las empresas...');
    conversacion = await prisma.conversacion.findFirst({
      where: { telefono: { contains: '962687089' } },
    });
  }
  if (!conversacion) {
    console.log('No se encontró ninguna conversación con ese teléfono. Revisar el número.');
    return;
  }
  imprimir(conversacion);
}

function imprimir(conversacion) {
  console.log(`empresaId: ${conversacion.empresaId}`);
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
