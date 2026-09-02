#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) el bug real reportado por
 * Ahorróptica: al preguntar por un segundo día en la misma conversación,
 * el modelo respondía con una lista de horarios completa pero INVENTADA
 * (imitando el formato del atajo real) para un día sin ninguna
 * disponibilidad real. Corre el mismo guion N veces seguidas (el bug
 * anterior de esta clase era probabilístico) contra una empresa de prueba
 * con un solo día con horas reales y otro sin ninguna.
 *
 * Uso: node scripts/_reproducir-horarios-inventados.js [N]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const REPETICIONES = Number(process.argv[2]) || 5;
const NOMBRE_EMPRESA_PRUEBA = 'PRUEBA CLAUDE - Horarios Inventados';
const TELEFONOS_PRUEBA = ['+56900000177', '+56900000176', '+56900000175', '+56900000174', '+56900000173'];

function proximoSabadoISO(desdeEnDias) {
  const hoy = new Date();
  const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + desdeEnDias));
  while (base.getUTCDay() !== 6) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().split('T')[0];
}
function sumarDias(fechaISO, n) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().split('T')[0];
}

async function limpiarPruebaPrevia() {
  const previa = await prisma.empresa.findFirst({ where: { nombre: NOMBRE_EMPRESA_PRUEBA } });
  if (!previa) return;
  const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: previa.id } });
  const recursoIds = recursos.map((r) => r.id);
  await prisma.cita.deleteMany({ where: { empresaId: previa.id } });
  await prisma.horarioExcepcion.deleteMany({ where: { recursoAgendableId: { in: recursoIds } } });
  await prisma.horarioSemanal.deleteMany({ where: { recursoAgendableId: { in: recursoIds } } });
  await prisma.conversacion.deleteMany({ where: { empresaId: previa.id } });
  await prisma.cliente.deleteMany({ where: { empresaId: previa.id } });
  await prisma.servicio.deleteMany({ where: { empresaId: previa.id } });
  await prisma.recursoAgendable.deleteMany({ where: { empresaId: previa.id } });
  await prisma.empresa.delete({ where: { id: previa.id } });
}

async function correrUnaVez(empresaCompleta, diaConHoras, diaSinHoras, telefono) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresaCompleta.id, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') throw new Error(`Teléfono ${telefono} ya usado por un cliente real.`);
  if (!cliente) cliente = await prisma.cliente.create({ data: { empresaId: empresaCompleta.id, telefono, nombre: 'PRUEBA CLAUDE' } });

  const historial = [];
  const transcripcion = [];
  async function turno(mensaje) {
    const resultado = await generarRespuestaChatbot({ empresa: empresaCompleta, cliente, historial, mensajeEntrante: mensaje });
    transcripcion.push(`>>> ${mensaje}\n<<< ${resultado.texto}`);
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
    return resultado.texto;
  }

  await turno('Hola');
  await turno('Quiero agendar el servicio "Evaluación examen visual".');
  const [, mesA, diaA] = diaConHoras.split('-');
  await turno(`Confirmo que quiero agendar para el ${diaConHoras}`);
  const textoDiaB = await turno(`Y para el ${Number(diaSinHoras.split('-')[2])} de ${['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][Number(diaSinHoras.split('-')[1])]}?`);

  // El bug real: el texto del día SIN horas mencionaba horarios concretos
  // como si existieran.
  const inventoHorarios = /\d{1,2}:\d{2}/.test(textoDiaB) && !/no (tenemos|hay)/i.test(textoDiaB);

  await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { telefono, empresaId: empresaCompleta.id } });
  await prisma.cliente.delete({ where: { id: cliente.id } });

  return { inventoHorarios, transcripcion };
}

async function main() {
  await limpiarPruebaPrevia();
  const rubro = await prisma.rubroTemplate.findFirst();
  const empresa = await prisma.empresa.create({ data: { nombre: NOMBRE_EMPRESA_PRUEBA, rubroTemplateId: rubro.id } });
  const recurso = await prisma.recursoAgendable.create({
    data: { empresaId: empresa.id, nombre: 'Recurso de prueba', duracionCitaMinutos: 15, anticipacionMinimaMin: 0, horizonteAgendaDias: 90 },
  });
  const diaConHoras = proximoSabadoISO(7); // vía excepción, como el caso real
  const diaSinHoras = sumarDias(diaConHoras, 1); // el domingo siguiente, sin excepción ni horario semanal
  await prisma.horarioExcepcion.create({
    data: { recursoAgendableId: recurso.id, fecha: diaConHoras, horaInicio: '09:00', horaFin: '13:00' },
  });
  await prisma.servicio.create({ data: { empresaId: empresa.id, nombre: 'Evaluación examen visual' } });
  const empresaCompleta = await prisma.empresa.findUnique({ where: { id: empresa.id }, include: { rubroTemplate: true } });

  console.log(`Día CON horas reales (excepción): ${diaConHoras}`);
  console.log(`Día SIN ninguna hora real: ${diaSinHoras}\n`);

  let fallos = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    process.stdout.write(`Corrida ${i + 1}/${REPETICIONES}... `);
    const { inventoHorarios, transcripcion } = await correrUnaVez(empresaCompleta, diaConHoras, diaSinHoras, TELEFONOS_PRUEBA[i]);
    if (inventoHorarios) {
      fallos++;
      console.log('❌ INVENTÓ horarios para un día sin disponibilidad real:');
      console.log(transcripcion.join('\n\n'));
    } else {
      console.log('✅ no inventó nada');
    }
  }

  console.log(`\n=== RESULTADO: ${REPETICIONES - fallos}/${REPETICIONES} corridas correctas ===`);

  await prisma.cita.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.horarioExcepcion.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.horarioSemanal.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.servicio.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.recursoAgendable.delete({ where: { id: recurso.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log('Limpieza completa.');
  process.exitCode = fallos === 0 ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
