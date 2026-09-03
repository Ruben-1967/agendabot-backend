#!/usr/bin/env node
/**
 * Reproduce en vivo (teléfono de prueba fijo, sin WhatsApp real) el guion
 * exacto reportado por Ahorróptica (2026-09-03): pedir el servicio
 * "Evaluación examen visual" y preguntar "Para hoy?" en un día SIN ninguna
 * hora real configurada (Marlene Gomez solo trabaja los viernes) — el bot
 * inventó 20 horarios (14:00-18:45) sin llamar a consultar_disponibilidad,
 * usando un wording que el detector viejo no reconocía ("para hoy" en vez
 * de "para el [día]"). Corre N veces porque el bug es probabilístico.
 *
 * Uso: node scripts/_reproducir-horas-inventadas-hoy.js [N]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { obtenerHorariosDisponibles } = require('../src/services/disponibilidad');
const { hoyISOEnChile } = require('../src/lib/horaChile');

const REPETICIONES = Number(process.argv[2]) || 5;
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONOS_PRUEBA = ['+56900000255', '+56900000254', '+56900000253', '+56900000252', '+56900000251'];

async function correrUnaVez(empresa, telefono) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') throw new Error(`Teléfono ${telefono} ya usado por un cliente real.`);
  if (!cliente) cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, telefono, nombre: 'PRUEBA CLAUDE' } });

  const historial = [];
  async function turno(mensaje) {
    const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
    return resultado;
  }

  await turno('Hola');
  await turno('Quiero agendar el servicio "Evaluación examen visual".');
  const resultadoFinal = await turno('Para hoy?');
  const texto = resultadoFinal.texto;

  const horasEnTexto = [...texto.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0]);

  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono } });
  await prisma.cliente.delete({ where: { id: cliente.id } });

  return { texto, horasEnTexto };
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  const hoy = hoyISOEnChile();
  const horasReales = await obtenerHorariosDisponibles(recurso.id, hoy);
  console.log(`Horas REALES para hoy (${hoy}):`, JSON.stringify(horasReales), '\n');

  if (horasReales.length > 0) {
    console.log('⚠️  Hoy SÍ tiene horas reales — este script está pensado para un día sin ninguna. Ajusta la fecha o espera a un día sin atención.');
    return;
  }

  let fallos = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    console.log(`Corrida ${i + 1}/${REPETICIONES}:`);
    const { texto, horasEnTexto } = await correrUnaVez(empresa, TELEFONOS_PRUEBA[i]);
    console.log(`  Horas mencionadas: ${JSON.stringify(horasEnTexto)}`);
    if (horasEnTexto.length >= 3) {
      fallos++;
      console.log(`  ❌ Mencionó ${horasEnTexto.length} horarios para un día sin ninguna disponibilidad real. Texto completo:\n${texto}\n`);
    } else {
      console.log('  ✅ No inventó una lista de horarios.');
    }
  }

  console.log(`\n=== RESULTADO: ${REPETICIONES - fallos}/${REPETICIONES} corridas correctas ===`);
  process.exitCode = fallos === 0 ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
