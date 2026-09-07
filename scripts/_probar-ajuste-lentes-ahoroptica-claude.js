#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) un cliente que quiere AJUSTAR sus
 * lentes -- el mismo tema que reportó el cliente real (56997894010) que
 * cayó 6 veces en el mensaje genérico de error en los últimos 7 días (ver
 * scripts/_diagnostico-ahorroptica.js). Objetivo: ver si "ajuste de
 * lentes" no calza con ninguna herramienta real del bot y lo deja dando
 * vueltas hasta agotar los 5 intentos.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-ajuste-lentes-ahoroptica-claude.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000098';

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  const inicio = Date.now();
  const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
  console.log(`<<< BOT (texto, ${Date.now() - inicio}ms):`, resultado.texto);
  if (resultado.interactivo) console.log('<<< BOT (interactivo):', JSON.stringify(resultado.interactivo));
  historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
  historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log('Empresa:', empresa.nombre);

  const servicios = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID }, select: { nombre: true } });
  console.log('Servicios reales configurados:', servicios.map((s) => s.nombre));

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  await turno(historial, empresa, cliente, 'Hola');
  await turno(historial, empresa, cliente, 'Quiero ajustar mis lentes, se me están cayendo');
  await turno(historial, empresa, cliente, 'Sí, quiero agendar para que me los ajusten');
  await turno(historial, empresa, cliente, '¿Cuándo tienen hora disponible para eso?');

  // Limpieza (incluye Cita por si el modelo sí llegó a agendar algo --
  // Cita.clienteId es FK obligatoria sin onDelete, así que sin esto un
  // cliente.delete() con una Cita real colgando fallaría a mitad de camino)
  await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('\nLimpieza completa.');
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
