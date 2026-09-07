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
process.env.DEBUG_CLAUDE_LOOP = '1'; // instrumentación temporal, ver services/claude.js
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000098';

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log('Empresa:', empresa.nombre);

  const servicios = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID }, select: { nombre: true } });
  console.log('Servicios reales configurados:', servicios.map((s) => s.nombre));

  // Frase EXACTA que el dueño probó por WhatsApp real y reprodujo el error,
  // como PRIMER mensaje de una conversación nueva -- se repite varias veces
  // en conversaciones nuevas independientes, porque la primera corrida de
  // este script NO reprodujo el error (el modelo no es 100% determinista
  // con el mismo prompt). Objetivo: aumentar la chance de agarrar la corrida
  // que sí falla, con el log de depuración prendido.
  const NUM_INTENTOS = 8;
  const resumen = [];

  for (let i = 1; i <= NUM_INTENTOS; i++) {
    console.log(`\n========== INTENTO GLOBAL ${i}/${NUM_INTENTOS} ==========`);

    let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
      throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
    }
    if (!cliente) {
      cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
    }

    const historial = [];
    let resultadoFinal;
    try {
      const inicio = Date.now();
      resultadoFinal = await generarRespuestaChatbot({
        empresa, cliente, historial, mensajeEntrante: '¿Ustedes reparan o ajustan lentes?',
      });
      console.log(`<<< BOT (texto, ${Date.now() - inicio}ms):`, resultadoFinal.texto);
    } finally {
      // Limpieza (incluye Cita por si el modelo sí llegó a agendar algo --
      // Cita.clienteId es FK obligatoria sin onDelete, así que sin esto un
      // cliente.delete() con una Cita real colgando fallaría a mitad de camino)
      await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
      await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
      await prisma.cliente.delete({ where: { id: cliente.id } });
    }

    const cayoEnError = resultadoFinal?.texto?.includes('tuve un problema procesando tu solicitud');
    resumen.push({ intento: i, cayoEnError });
  }

  console.log('\n===== RESUMEN =====');
  console.log(JSON.stringify(resumen, null, 2));
  console.log(`Fallos: ${resumen.filter((r) => r.cayoEnError).length} de ${NUM_INTENTOS}`);
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
