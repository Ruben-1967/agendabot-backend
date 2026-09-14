#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) el fix pedido por el usuario
 * (2026-09-14, tras el reporte de Ahorróptica con la clienta "Rosa Levi"):
 * cuando el bot ya preguntó una vez por el servicio y el cliente responde
 * sin elegir ninguno (ej. da su nombre en vez de tocar una opción), la
 * segunda pregunta debe usar un texto distinto (reconociendo su mensaje y
 * apuntando al menú) en vez de repetir el texto fijo idéntico -- ver
 * TEXTO_PREGUNTA_SERVICIOS_REPETIDA en src/services/claude.js.
 *
 * Mismo patrón seguro que los scripts _probar-*-ahoroptica.js: teléfono de
 * prueba fijo, guardia contra pisar un cliente real, limpieza al final.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-pregunta-servicios-repetida-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000099';

const TURNOS_CLIENTE = [
  '¡Hola! Quiero más información.',
  'Soy la sra Rosa Levi',
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
  const textos = [];
  try {
    for (let i = 0; i < TURNOS_CLIENTE.length; i++) {
      const mensajeEntrante = TURNOS_CLIENTE[i];
      console.log(`\n>>> CLIENTE (turno ${i + 1}):`, mensajeEntrante);

      const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante });
      console.log('<<< BOT:', resultado.texto);
      console.log('    interactivo:', resultado.interactivo ? resultado.interactivo.tipo : null);
      textos.push(resultado.texto);

      historial.push(
        { rol: 'usuario', contenido: mensajeEntrante, timestamp: new Date().toISOString() },
        { rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() }
      );
    }

    if (textos.length === 2 && textos[0] !== textos[1] && textos[0].includes('¿Para cuál de estos servicios')) {
      console.log('\n✅ La segunda pregunta usó un texto distinto de la primera (no repitió idéntico).');
    } else {
      console.log('\n⚠️  La segunda pregunta salió IGUAL a la primera — el fix no está funcionando.');
    }
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
