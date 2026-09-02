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
    return resultado;
  }

  await turno('Hola');
  await turno('Tiene horas para examen');
  const resultadoFinal = await turno('?');
  const textoFinal = resultadoFinal.texto;

  // El atajo real (armarTextoProximosDias) no escribe fechas en el texto —
  // las manda en resultado.interactivo.dias (lista interactiva). Por eso la
  // prueba real de "no fabricó nada" es que SÍ llamó al atajo (interactivo
  // presente, con exactamente los días reales) — el texto solo sirve para
  // pescar una fabricación libre tipo "4 de septiembre (viernes)".
  const diasInteractivo = resultadoFinal.interactivo?.tipo === 'lista_dias'
    ? resultadoFinal.interactivo.dias.map((d) => Number(d.fecha.split('-')[2]))
    : null;
  const diasMencionados = [...textoFinal.matchAll(/(\d{1,2})\s+de\s+septiembre/gi)].map((m) => Number(m[1]));
  const diaInventadoEnTexto = diasMencionados.find((d) => !diasRealesValidos.includes(d));
  const diaInventadoEnInteractivo = diasInteractivo?.find((d) => !diasRealesValidos.includes(d));
  const disparoAtajoReal = diasInteractivo !== null && diasInteractivo.length > 0 && !diaInventadoEnInteractivo;

  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono } });
  await prisma.cliente.delete({ where: { id: cliente.id } });

  return { textoFinal, diasMencionados, diaInventadoEnTexto, diasInteractivo, diaInventadoEnInteractivo, disparoAtajoReal };
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
    const { textoFinal, diasMencionados, diaInventadoEnTexto, diasInteractivo, diaInventadoEnInteractivo, disparoAtajoReal } =
      await correrUnaVez(empresa, recurso, diasRealesValidos, TELEFONOS_PRUEBA[i]);
    console.log(`  Días en el texto: ${JSON.stringify(diasMencionados)} | Días en la lista interactiva: ${JSON.stringify(diasInteractivo)}`);
    if (diaInventadoEnTexto || diaInventadoEnInteractivo) {
      fallos++;
      console.log(`  ❌ Mencionó un día (${diaInventadoEnTexto ?? diaInventadoEnInteractivo}) que NO tiene disponibilidad real. Texto completo:\n${textoFinal}\n`);
    } else if (!disparoAtajoReal) {
      fallos++;
      console.log(`  ❌ NO llamó al atajo real (consultar_proximos_dias_disponibles) — no hay lista interactiva de días. Texto completo:\n${textoFinal}\n`);
    } else {
      console.log('  ✅ Llamó a la herramienta real y los días coinciden con el calendario real.');
    }
  }

  console.log(`\n=== RESULTADO: ${REPETICIONES - fallos}/${REPETICIONES} corridas correctas ===`);
  process.exitCode = fallos === 0 ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
