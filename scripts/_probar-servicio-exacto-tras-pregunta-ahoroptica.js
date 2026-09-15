#!/usr/bin/env node
/**
 * Prueba MÁS directa que _probar-servicio-nombrado-exacto-ahoroptica.js:
 * en vez de dejar que Claude decida por su cuenta si pregunta o no por el
 * servicio (con un solo servicio real, a veces se lo salta y no ejercita
 * la rama del bug), fuerza el historial exacto del caso real reportado
 * (el bot YA preguntó "¿Para cuál de estos servicios necesitas la hora?")
 * y solo entonces manda "Evaluación examen visual" -- exactamente la
 * secuencia de las capturas del usuario.
 *
 * Mismo patrón seguro: teléfono de prueba fijo, guardia, limpieza.
 *
 * USO (Shell de Render, producción):
 *   node scripts/_probar-servicio-exacto-tras-pregunta-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000502';

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

  try {
    const historial = [
      { rol: 'usuario', contenido: 'Hola, quiero agendar una hora', timestamp: new Date().toISOString() },
      { rol: 'asistente', contenido: '¿Para cuál de estos servicios necesitas la hora? 👇', timestamp: new Date().toISOString() },
    ];

    console.log('\n(historial forzado: el bot ya preguntó por el servicio)');
    console.log('>>> CLIENTE:', 'Evaluación examen visual');

    const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: 'Evaluación examen visual' });
    console.log('<<< BOT:', resultado.texto);
    console.log('    interactivo:', resultado.interactivo ? resultado.interactivo.tipo : null);

    const ok = resultado.interactivo?.tipo === 'lista_dias' || resultado.interactivo?.tipo === 'lista_horarios';
    console.log(ok
      ? '\n✅ Avanzó correctamente a días/horarios -- NO repitió la lista de servicios.'
      : '\n⚠️  FALLÓ: repitió la lista de servicios o se quedó pegado.');
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
