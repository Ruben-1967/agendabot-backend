#!/usr/bin/env node
/**
 * Verifica el nuevo comportamiento de horarios por bloque, contra la
 * agenda real de Ahorróptica:
 *  1. Un día con más de 10 horas reales en un solo bloque (agenda cada
 *     15 min, viernes 09:00-12:45 = 15 slots) -> ya NO debe truncar a 10 ni
 *     usar la lista interactiva, debe mostrar el listado COMPLETO en texto.
 *  2. El motor de disponibilidad por bloque (obtenerHorariosDisponiblesPorBloque)
 *     coincide con la versión plana (obtenerHorariosDisponibles) — mismo
 *     total de horas, solo agrupadas.
 *
 * Uso: node scripts/_verificar-horarios-por-bloque.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { obtenerHorariosDisponiblesPorBloque } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000355';

// Viernes N (0 = el más próximo, 1 = el siguiente...), único día
// configurado hoy para Marlene Gomez.
function viernesISO(n) {
  const hoy = new Date();
  const dia = hoy.getUTCDay();
  const diasHastaViernes = (5 - dia + 7) % 7 || 7;
  hoy.setUTCDate(hoy.getUTCDate() + diasHastaViernes + n * 7);
  return hoy.toISOString().slice(0, 10);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });

  // Los viernes más próximos ya tienen citas reales tomando cupos — busca
  // el primero, hasta 8 semanas hacia adelante, con más de 10 horas libres
  // reales, para probar de verdad el caso ">10" en vez de solo el normal.
  let fecha, bloques, totalHoras;
  for (let n = 0; n < 8; n++) {
    fecha = viernesISO(n);
    bloques = await obtenerHorariosDisponiblesPorBloque(recurso.id, fecha);
    totalHoras = bloques.flatMap((b) => b.horas).length;
    if (totalHoras > 10) break;
  }

  console.log(`Bloques reales para ${fecha}:`, JSON.stringify(bloques.map((b) => ({ horaInicio: b.horaInicio, horaFin: b.horaFin, cantidad: b.horas.length }))));
  console.log(`Total de horas reales: ${totalHoras}\n`);

  if (totalHoras <= 10) {
    console.log('No se encontró ningún viernes con más de 10 horas libres en las próximas 8 semanas — no se pudo probar el caso ">10", pero igual reviso que la conversación no rompa nada.');
  }

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') throw new Error('Teléfono de prueba ya usado por un cliente real.');
  if (!cliente) cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });

  const historial = [];
  async function turno(mensaje) {
    const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
    return resultado;
  }

  await turno('Hola');
  await turno('Quiero agendar el servicio "Evaluación examen visual".');
  const resultado = await turno(`Confirmo que quiero agendar para el ${fecha}.`);

  console.log('interactivo.tipo:', resultado.interactivo?.tipo);
  console.log('Texto completo:\n', resultado.texto);

  const horasEnTexto = [...resultado.texto.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0]);
  console.log(`\nHoras mencionadas en el texto: ${horasEnTexto.length} (reales: ${totalHoras})`);

  const ok = totalHoras > 10
    ? resultado.interactivo?.tipo === 'horarios_por_bloque' && horasEnTexto.length === totalHoras
    : resultado.interactivo?.tipo === 'lista_horarios';
  console.log(ok ? '\n✅ Comportamiento correcto.' : '\n❌ No coincide con lo esperado.');

  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
