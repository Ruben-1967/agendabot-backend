#!/usr/bin/env node
/**
 * URGENTE: Ahorróptica reporta que el bot dejó de responder. Reproduce en
 * vivo (sin WhatsApp real, teléfono de prueba fijo) una conversación real
 * contra la empresa REAL de Ahorróptica, usando exactamente
 * generarRespuestaChatbot() como el webhook real — para atrapar cualquier
 * excepción que hoy quedaría silenciada (server.js solo loguea el error y
 * no responde nada al cliente).
 *
 * Aborta si el teléfono de prueba ya pertenece a un cliente real. Limpia
 * lo que crea al final.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-bot-ahoroptica-urgente.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000188';

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  try {
    const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
    console.log('<<< BOT (texto):', resultado.texto);
    if (resultado.interactivo) console.log('<<< BOT (interactivo):', JSON.stringify(resultado.interactivo));
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('\n❌❌❌ EXCEPCIÓN NO CAPTURADA (esto es lo que está pasando en producción — el cliente no recibe nada):');
    console.error(err);
    throw err;
  }
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  if (!empresa) throw new Error('No se encontró la empresa de Ahorróptica.');
  console.log('Empresa:', empresa.nombre, '| rubro:', empresa.rubroTemplate.nombre);

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  let ok = true;
  try {
    await turno(historial, empresa, cliente, 'Hola');
    await turno(historial, empresa, cliente, 'Quiero agendar una hora');
    await turno(historial, empresa, cliente, 'Y qué servicios tienen?');
  } catch (err) {
    ok = false;
  }

  // Limpieza
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('\nLimpieza completa.');

  console.log(ok ? '\n✅ El bot respondió normal en los 3 turnos — no se reprodujo el problema con este guion.' : '\n❌ Se encontró una excepción real — ver arriba.');
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error('ERROR GENERAL:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
