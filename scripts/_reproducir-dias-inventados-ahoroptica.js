#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real, teléfono de prueba fijo) el guion
 * EXACTO del caso real reportado (Ahorróptica, 2026-09-02): "Hola" ->
 * "Tiene horas para examen" -> el bot pregunta qué día -> cliente responde
 * "?" -> el bot debía consultar próximos días reales, pero inventó
 * 4/5/6 de septiembre (ninguno con disponibilidad real). Corre N veces (el
 * bug es probabilístico) contra la empresa REAL de Ahorróptica.
 *
 * Aborta si el teléfono de prueba ya pertenece a un cliente real. Limpia
 * lo que crea al final.
 *
 * Uso: node scripts/_reproducir-dias-inventados-ahoroptica.js [N]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const REPETICIONES = Number(process.argv[2]) || 5;
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONOS_PRUEBA = ['+56900000155', '+56900000154', '+56900000153', '+56900000152', '+56900000151'];

async function correrUnaVez(empresa, recurso, diasRealesValidos, telefono) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') throw new Error(`Teléfono ${telefono} ya usado por un cliente real.`);
  if (!cliente) cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, telefono, nombre: 'PRUEBA CLAUDE' } });

  const historial = [];
  async function turno(mensaje) {
    const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
    return resultado.texto;
  }

  await turno('Hola');
  await turno('Tiene horas para examen');
  const textoFinal = await turno('?');

  // Extrae cualquier "N de septiembre" mencionado en la respuesta final.
  const diasMencionados = [...textoFinal.matchAll(/(\d{1,2})\s+de\s+septiembre/gi)].map((m) => Number(m[1]));
  const diaInventado = diasMencionados.find((d) => !diasRealesValidos.includes(d));

  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono } });
  await prisma.cliente.delete({ where: { id: cliente.id } });

  return { textoFinal, diasMencionados, diaInventado };
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  const diasReales = await obtenerProximosDiasConDisponibilidad(recurso.id, 7);
  const diasRealesValidos = diasReales.map((d) => Number(d.fecha.split('-')[2]));
  console.log('Días REALES con disponibilidad ahora mismo:', diasRealesValidos, '\n');

  let fallos = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    console.log(`Corrida ${i + 1}/${REPETICIONES}:`);
    const { textoFinal, diasMencionados, diaInventado } = await correrUnaVez(empresa, recurso, diasRealesValidos, TELEFONOS_PRUEBA[i]);
    console.log(`  Días mencionados en la respuesta: ${JSON.stringify(diasMencionados)}`);
    if (diaInventado) {
      fallos++;
      console.log(`  ❌ Mencionó el día ${diaInventado} de septiembre, que NO tiene disponibilidad real. Texto completo:\n${textoFinal}\n`);
    } else {
      console.log('  ✅ Todos los días mencionados son reales (o no mencionó ninguno).');
    }
  }

  console.log(`\n=== RESULTADO: ${REPETICIONES - fallos}/${REPETICIONES} corridas correctas ===`);
  process.exitCode = fallos === 0 ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
