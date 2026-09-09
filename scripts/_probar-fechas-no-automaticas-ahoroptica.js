#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) el reporte de Ahorróptica: "el bot
 * no dispara automáticamente las fechas disponibles, hay que insistir".
 * Mismo patrón seguro que _probar-ajuste-lentes-ahoroptica-claude.js:
 * teléfono de prueba fijo, guardia contra pisar un cliente real, limpieza
 * al final.
 *
 * Simula un cliente que pide hora SIN mencionar servicio ni día en el
 * primer mensaje (el caso más común real) y sigue la conversación turno a
 * turno, mirando en qué mensaje (si alguno) aparece el `interactivo` de
 * tipo lista_dias/lista_horarios -- para ver cuántos turnos hacen falta.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-fechas-no-automaticas-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000098';

// Turnos del cliente a probar en secuencia -- el primero es el mensaje real
// más típico de alguien pidiendo hora sin dar detalles todavía.
const TURNOS_CLIENTE = [
  'Hola, quiero agendar una hora',
  'Examen visual',
];

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
  try {
    for (let i = 0; i < TURNOS_CLIENTE.length; i++) {
      const mensajeEntrante = TURNOS_CLIENTE[i];
      console.log(`\n>>> CLIENTE (turno ${i + 1}):`, mensajeEntrante);

      const inicio = Date.now();
      const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante });
      console.log(`<<< BOT (${Date.now() - inicio}ms):`, resultado.texto);
      console.log('    interactivo:', resultado.interactivo ? resultado.interactivo.tipo : null);

      historial.push(
        { rol: 'usuario', contenido: mensajeEntrante, timestamp: new Date().toISOString() },
        { rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() }
      );

      if (resultado.interactivo?.tipo === 'lista_dias' || resultado.interactivo?.tipo === 'lista_horarios') {
        console.log(`\n✅ Disparó la lista en el turno ${i + 1} de ${TURNOS_CLIENTE.length}.`);
        return;
      }
    }
    console.log(`\n⚠️  Nunca disparó lista_dias/lista_horarios en los ${TURNOS_CLIENTE.length} turnos probados.`);
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
