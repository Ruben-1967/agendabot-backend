#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) el bug real reportado: Ahorróptica
 * tiene un cliente (Conversacion 44cd4477..., tel. 56940369712) a quien el
 * bot le dijo "¡Listo! Tu cita ha sido agendada exitosamente" con resumen
 * completo, pero el Cliente quedó con 0 citas en la base.
 *
 * Corre el mismo guion de mensajes (día+hora -> datos -> "si") N veces
 * seguidas (el bug es probabilístico — el modelo no siempre omite la
 * llamada a agendar_cita) contra una empresa de prueba con requiereRut=true,
 * y reporta cuántas de esas corridas terminan con una Cita real creada.
 * Solo imprime la transcripción completa de las corridas que fallan.
 *
 * Crea su propia Empresa/Recurso/Servicio/Cliente de prueba y los borra al
 * final de cada corrida. Uso: node scripts/_reproducir-cita-fantasma.js [N]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const REPETICIONES = Number(process.argv[2]) || 8;
const NOMBRE_EMPRESA_PRUEBA = 'PRUEBA CLAUDE - Cita Fantasma';
const TELEFONOS_PRUEBA = [
  '+56900000199', '+56900000198', '+56900000197', '+56900000196',
  '+56900000195', '+56900000194', '+56900000193', '+56900000192',
  '+56900000191', '+56900000190',
];

function proximoSabadoISO(desdeEnDias) {
  const hoy = new Date();
  const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + desdeEnDias));
  while (base.getUTCDay() !== 6) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().split('T')[0];
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

async function contarCitas(clienteId) {
  return prisma.cita.count({ where: { clienteId } });
}

async function correrUnaVez(empresaCompleta, recurso, sabado, telefono) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresaCompleta.id, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ${telefono} ya usado por un cliente real — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: empresaCompleta.id, telefono, nombre: 'PRUEBA CLAUDE' } });
  }

  const transcripcion = [];
  const historial = [];
  async function turno(mensaje) {
    const resultado = await generarRespuestaChatbot({ empresa: empresaCompleta, cliente, historial, mensajeEntrante: mensaje });
    transcripcion.push(`>>> CLIENTE: ${mensaje}\n<<< BOT: ${resultado.texto}`);
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  }

  await turno('hola');
  await turno('agendar cita');
  await turno('Quiero agendar el servicio "Evaluación examen visual".');
  await turno(`Confirmo que quiero agendar para el ${sabado} a las 09:15.`);
  await turno('Prueba Claude Reproduccion\n11111111-1\n' + telefono);
  await turno('si');

  const citas = await contarCitas(cliente.id);

  // Limpieza de este cliente puntual
  await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { telefono, empresaId: empresaCompleta.id } });
  await prisma.cliente.delete({ where: { id: cliente.id } });

  return { citas, transcripcion };
}

async function main() {
  await limpiarPruebaPrevia();
  const rubro = await prisma.rubroTemplate.findFirst();
  const empresa = await prisma.empresa.create({
    data: { nombre: NOMBRE_EMPRESA_PRUEBA, rubroTemplateId: rubro.id, requiereRut: true },
  });
  const recurso = await prisma.recursoAgendable.create({
    data: { empresaId: empresa.id, nombre: 'Recurso de prueba', duracionCitaMinutos: 15, anticipacionMinimaMin: 0, horizonteAgendaDias: 90 },
  });
  const sabado = proximoSabadoISO(7);
  await prisma.horarioExcepcion.create({
    data: { recursoAgendableId: recurso.id, fecha: sabado, horaInicio: '09:00', horaFin: '13:30' },
  });
  await prisma.servicio.create({ data: { empresaId: empresa.id, nombre: 'Evaluación examen visual' } });
  const empresaCompleta = await prisma.empresa.findUnique({ where: { id: empresa.id }, include: { rubroTemplate: true } });

  if (REPETICIONES > TELEFONOS_PRUEBA.length) {
    throw new Error(`Máximo ${TELEFONOS_PRUEBA.length} repeticiones (uno por teléfono de prueba fijo).`);
  }

  let exitos = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    process.stdout.write(`Corrida ${i + 1}/${REPETICIONES}... `);
    const { citas, transcripcion } = await correrUnaVez(empresaCompleta, recurso, sabado, TELEFONOS_PRUEBA[i]);
    if (citas > 0) {
      exitos++;
      console.log('✅ cita real creada');
    } else {
      console.log('❌ SIN cita real (bug reproducido) — transcripción completa:');
      console.log(transcripcion.join('\n\n'));
    }
  }

  console.log(`\n=== RESULTADO FINAL: ${exitos}/${REPETICIONES} corridas terminaron con una cita real creada ===`);

  // Limpieza de la empresa de prueba
  await prisma.cita.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.horarioExcepcion.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.horarioSemanal.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.servicio.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.recursoAgendable.delete({ where: { id: recurso.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log('Limpieza completa.');
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
