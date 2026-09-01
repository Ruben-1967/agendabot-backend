#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) un cliente preguntando puntualmente
 * por disponibilidad el domingo con Ahorróptica — que hoy solo tiene
 * horario configurado el viernes. Objetivo: confirmar si el modelo
 * responde con datos reales (debería decir que no hay domingo) o inventa
 * algo en el texto, ya que la herramienta de disponibilidad en sí (ver
 * _diagnosticar-disponibilidad-ahoroptica.js) confirmó que NUNCA devuelve
 * horas para domingo.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-domingo-ahoroptica-claude.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000097';

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
  console.log('<<< BOT (texto):', resultado.texto);
  if (resultado.interactivo) console.log('<<< BOT (interactivo):', JSON.stringify(resultado.interactivo));
  historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
  historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log('Empresa:', empresa.nombre);

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  await turno(historial, empresa, cliente, 'Hola');
  await turno(historial, empresa, cliente, 'Quiero agendar el servicio Evaluación examen visual');
  await turno(historial, empresa, cliente, '¿Tienen disponibilidad el domingo?');
  await turno(historial, empresa, cliente, 'Y si no, ¿qué día es el próximo disponible?');

  // Limpieza
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('\nLimpieza completa.');
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
