#!/usr/bin/env node
/**
 * Verifica el fix de "escalar a humano" (Ahorróptica, 2026-09-02): antes,
 * cuando el cliente pedía hablar con un ejecutivo, el bot solo lo decía en
 * texto sin pausar de verdad — el siguiente mensaje del cliente volvía a
 * recibir un saludo automático. Usa procesarMensajeEntrante() (la función
 * real que arma el webhook) para probar el ciclo completo, incluida la
 * persistencia de pausadaPorHumanoEn.
 *
 * Corre el guion N veces (el bug de "el modelo no llama la herramienta" es
 * probabilístico). Uso: node scripts/_reproducir-escalar-humano.js [N]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarMensajeEntrante } = require('../src/services/chatbotEngine');

const REPETICIONES = Number(process.argv[2]) || 5;
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONOS_PRUEBA = ['+56900000166', '+56900000165', '+56900000164', '+56900000163', '+56900000162'];

async function correrUnaVez(empresa, telefono) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') throw new Error(`Teléfono ${telefono} ya usado por un cliente real.`);

  await procesarMensajeEntrante({ empresa, telefonoCliente: telefono, textoEntrante: 'Hola', nombreContacto: 'PRUEBA CLAUDE' });
  const r1 = await procesarMensajeEntrante({ empresa, telefonoCliente: telefono, textoEntrante: 'Quiero hablar con un ejecutivo, no con un bot', nombreContacto: 'PRUEBA CLAUDE' });

  const conversacion = await prisma.conversacion.findFirst({ where: { empresaId: empresa.id, telefono } });
  const quedoPausada = !!conversacion?.pausadaPorHumanoEn;

  // Simula el cliente escribiendo de nuevo — NO debería recibir respuesta
  // automática si quedó pausada de verdad.
  const r2 = await procesarMensajeEntrante({ empresa, telefonoCliente: telefono, textoEntrante: 'Hola de nuevo', nombreContacto: 'PRUEBA CLAUDE' });
  const siguioRespondiendo = r2.respuestaTexto !== null;

  const ok = quedoPausada && !siguioRespondiendo;

  console.log(`  Respuesta al pedir ejecutivo: "${r1.respuestaTexto}"`);
  console.log(`  pausadaPorHumanoEn quedó seteada: ${quedoPausada}`);
  console.log(`  Bot siguió respondiendo automático después: ${siguioRespondiendo} (esperado: false)`);

  cliente = cliente || (await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono } }));
  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono } });
  if (cliente) await prisma.cliente.delete({ where: { id: cliente.id } });

  return ok;
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  let fallos = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    console.log(`\nCorrida ${i + 1}/${REPETICIONES}:`);
    const ok = await correrUnaVez(empresa, TELEFONOS_PRUEBA[i]);
    console.log(ok ? '  ✅ OK' : '  ❌ FALLO');
    if (!ok) fallos++;
  }
  console.log(`\n=== RESULTADO: ${REPETICIONES - fallos}/${REPETICIONES} corridas correctas ===`);
  process.exitCode = fallos === 0 ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
