#!/usr/bin/env node
/**
 * Reproduce en vivo (sin WhatsApp real) el bug real reportado: Ahorróptica
 * tiene un cliente (Conversacion 44cd4477..., tel. 56940369712) a quien el
 * bot le dijo "¡Listo! Tu cita ha sido agendada exitosamente" con resumen
 * completo, pero el Cliente quedó con 0 citas en la base.
 *
 * Replica el mismo guion de mensajes (día+hora -> datos -> "si") contra una
 * empresa de prueba con requiereRut=true, y chequea DESPUÉS DE CADA TURNO
 * si ya existe una Cita real en la base — para saber en qué momento exacto
 * agendar_cita se ejecuta (o no) respecto a cuándo el bot dice "listo".
 *
 * Crea su propia Empresa/Recurso/Servicio/Cliente de prueba y los borra al
 * final. Uso: node scripts/_reproducir-cita-fantasma.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const NOMBRE_EMPRESA_PRUEBA = 'PRUEBA CLAUDE - Cita Fantasma';
const TELEFONO_PRUEBA = '+56900000199';

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

async function main() {
  await limpiarPruebaPrevia();
  const rubro = await prisma.rubroTemplate.findFirst();
  const empresa = await prisma.empresa.create({
    data: { nombre: NOMBRE_EMPRESA_PRUEBA, rubroTemplateId: rubro.id, requiereRut: true },
  });
  const recurso = await prisma.recursoAgendable.create({
    data: { empresaId: empresa.id, nombre: 'Recurso de prueba', duracionCitaMinutos: 15, anticipacionMinimaMin: 0, horizonteAgendaDias: 90 },
  });
  const sabado = proximoSabadoISO(7); // igual que el caso real: un sábado vía excepción
  await prisma.horarioExcepcion.create({
    data: { recursoAgendableId: recurso.id, fecha: sabado, horaInicio: '09:00', horaFin: '13:30' },
  });
  await prisma.servicio.create({ data: { empresaId: empresa.id, nombre: 'Evaluación examen visual' } });

  const empresaCompleta = await prisma.empresa.findUnique({ where: { id: empresa.id }, include: { rubroTemplate: true } });

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error('Teléfono de prueba ya usado por un cliente real — abortando.');
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  async function turno(mensaje) {
    console.log(`\n>>> CLIENTE: ${mensaje}`);
    const antes = await contarCitas(cliente.id);
    const resultado = await generarRespuestaChatbot({ empresa: empresaCompleta, cliente, historial, mensajeEntrante: mensaje });
    const despues = await contarCitas(cliente.id);
    console.log('<<< BOT:', resultado.texto);
    if (despues > antes) console.log(`    (*** se creó una Cita real en este turno: ${antes} -> ${despues} ***)`);
    historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
    historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  }

  await turno('hola');
  await turno('agendar cita');
  await turno('Quiero agendar el servicio "Evaluación examen visual".');
  await turno(`Confirmo que quiero agendar para el ${sabado} a las 09:15.`);
  await turno('Prueba Claude Reproduccion\n11111111-1\n' + TELEFONO_PRUEBA);
  await turno('si');

  const citasFinal = await prisma.cita.findMany({ where: { clienteId: cliente.id } });
  console.log(`\n=== RESULTADO: el cliente de prueba quedó con ${citasFinal.length} cita(s) real(es) en la base ===`);
  if (citasFinal.length === 0) {
    console.log('❌ REPRODUCIDO: el bot dijo que agendó pero NO hay ninguna cita real — mismo bug que reportó Ahorróptica.');
  } else {
    console.log('✅ NO reproducido en este intento: sí se creó la cita correctamente.');
    citasFinal.forEach((c) => console.log(`  - fechaHoraInicio(UTC)=${c.fechaHoraInicio.toISOString()} estado=${c.estado}`));
  }

  // Limpieza
  await prisma.cita.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.horarioExcepcion.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.horarioSemanal.deleteMany({ where: { recursoAgendableId: recurso.id } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  await prisma.servicio.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.recursoAgendable.delete({ where: { id: recurso.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log('\nLimpieza completa.');
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
