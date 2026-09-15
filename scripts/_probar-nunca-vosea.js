#!/usr/bin/env node
/**
 * Reproduce el bug reportado (2026-09-15): el bot empezó a vosear
 * ("tenés", "podés", "vos") en vez de tutear -- verifica que la regla
 * estricta agregada al system prompt (claude.js) evita esto, incluso
 * cuando el CLIENTE le escribe en voseo (probado explícitamente, porque
 * el modelo tiende a "reflejar" el registro del interlocutor).
 *
 * Usa el negocio de demo "Estudio Bella Piel" (Staging) -- la regla vive
 * en el system prompt compartido (claude.js), no es específica de
 * Ahorróptica, así que cualquier negocio real sirve para verificarla.
 *
 * USO (Shell de Render, Staging o producción -- necesita ANTHROPIC_API_KEY):
 *   node scripts/_probar-nunca-vosea.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo)
const TELEFONO_PRUEBA = '+56900000401';

const REGEX_VOSEO = /\b(vos|tenés|tenes|podés|podes|querés|queres|necesitás|necesitas(?!.{0,3}\?)|sos\b|andá|andate|fijate|escribime|decime|contame|mandame)\b/i;

const TURNOS_CLIENTE = [
  'Hola, ¿vos me podés decir qué servicios tenés disponibles?',
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
  let huboVoseo = false;
  try {
    for (let i = 0; i < TURNOS_CLIENTE.length; i++) {
      const mensajeEntrante = TURNOS_CLIENTE[i];
      console.log(`\n>>> CLIENTE (en voseo, a propósito):`, mensajeEntrante);

      const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante });
      console.log('<<< BOT:', resultado.texto);

      if (REGEX_VOSEO.test(resultado.texto || '')) {
        huboVoseo = true;
        console.log('⚠️  Se detectó voseo en la respuesta del bot.');
      }

      historial.push(
        { rol: 'usuario', contenido: mensajeEntrante, timestamp: new Date().toISOString() },
        { rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() }
      );
    }

    console.log(huboVoseo ? '\n⚠️  FALLÓ: el bot voseó.' : '\n✅ OK: el bot tuteó en todo momento, incluso con el cliente escribiendo en voseo.');
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
