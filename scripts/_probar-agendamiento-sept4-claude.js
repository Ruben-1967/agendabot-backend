#!/usr/bin/env node
/**
 * Reproduce en vivo, contra el motor real del bot (sin pasar por WhatsApp),
 * un intento de agendar para el 4 de septiembre de 2026 con Ahorróptica —
 * para diagnosticar por qué un cliente real no logró agendar esa fecha.
 *
 * Corre DOS escenarios con el mismo destino final (servicio + fecha + hora):
 *   1. "tap de lista": el cliente toca los botones de WhatsApp — server.js
 *      convierte cada tap en una frase fija ('Quiero agendar el servicio
 *      "X".', 'Confirmo que quiero agendar para el YYYY-MM-DD a las HH:MM.').
 *   2. "texto libre": el cliente escribe la misma intención con sus propias
 *      palabras en vez de tocar el botón — esto es lo que de verdad hizo el
 *      cliente real, según lo reportado, y fue lo que se atascó en la
 *      primera corrida de este script (probado 2026-08-31, ver memoria del
 *      proyecto). El fix (system prompt en claude.js) debería hacer que
 *      este escenario también agende bien ahora.
 *
 * No envía ningún WhatsApp real (no llama a services/whatsapp.js) — solo
 * llama a generarRespuestaChatbot(), el mismo motor que usa el webhook real,
 * con teléfonos de prueba fijos (nunca generados al azar). Crea Cliente +
 * Conversacion + posible Cita de prueba en la base de PRODUCCIÓN por cada
 * escenario, y los borra al final de cada uno.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-agendamiento-sept4-claude.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { obtenerHorariosDisponibles, obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
  console.log('<<< BOT (texto):', resultado.texto);
  if (resultado.interactivo) console.log('<<< BOT (interactivo):', JSON.stringify(resultado.interactivo));
  historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
  historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  return resultado;
}

async function correrEscenario({ nombreEscenario, telefonoPrueba, empresa, mensajes }) {
  console.log(`\n\n========== ESCENARIO: ${nombreEscenario} ==========`);

  // Si por algún motivo ya existiera un Cliente real con este teléfono de
  // prueba (telefono no es @unique en el schema), NUNCA lo reutilizamos ni
  // lo tocamos — abortamos, para no arriesgarnos a limpiar al final datos
  // de un paciente real.
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: telefonoPrueba } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Ya existe un Cliente real con el teléfono de prueba ${telefonoPrueba} (id ${cliente.id}, nombre "${cliente.nombre}") — abortando para no tocarlo.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: telefonoPrueba, nombre: 'PRUEBA CLAUDE' } });
  }
  console.log('Cliente de prueba:', cliente.id);

  const historial = [];
  for (const mensaje of mensajes) {
    await turno(historial, empresa, cliente, mensaje);
  }

  const citaCreada = await prisma.cita.findFirst({
    where: { empresaId: EMPRESA_ID, clienteId: cliente.id, fechaHoraInicio: { gte: new Date('2026-09-04T00:00:00Z'), lt: new Date('2026-09-05T00:00:00Z') } },
  });
  console.log(`\n¿Se creó la cita? ${citaCreada ? `SÍ (id ${citaCreada.id}, estado ${citaCreada.estado})` : 'NO'}`);

  await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: telefonoPrueba } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('Limpieza completa.');

  return Boolean(citaCreada);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  if (!empresa) throw new Error('No se encontró la empresa');
  console.log('Empresa:', empresa.nombre, '| requiereRut:', empresa.requiereRut);

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso?.nombre, '| horizonteAgendaDias:', recurso?.horizonteAgendaDias);

  const horasDirecto = await obtenerHorariosDisponibles(recurso.id, '2026-09-04');
  console.log('\n[Chequeo directo] Horas disponibles 2026-09-04:', JSON.stringify(horasDirecto));
  const proximosDias = await obtenerProximosDiasConDisponibilidad(recurso.id, 7);
  console.log('[Chequeo directo] Próximos días con disponibilidad:', JSON.stringify(proximosDias.map((d) => d.fecha)));

  if (horasDirecto.length === 0) {
    console.log('\nNo hay horas disponibles el 2026-09-04 ahora mismo — no se puede probar. Ajusta la fecha en el script.');
    return;
  }
  const primeraHora = horasDirecto[0];
  const datosContacto = 'Mi nombre es Prueba Claude, mi rut es 11111111-1 y mi teléfono de contacto es +56900000000';

  const okTap = await correrEscenario({
    nombreEscenario: 'tap de lista (como un chat real donde el cliente toca los botones)',
    telefonoPrueba: '+56900000099',
    empresa,
    mensajes: [
      'Hola',
      'Quiero agendar una hora para el 4 de septiembre',
      'Quiero agendar el servicio "Evaluación examen visual".',
      `Confirmo que quiero agendar para el 2026-09-04 a las ${primeraHora}.`,
      ...(empresa.requiereRut ? [datosContacto] : []),
    ],
  });

  const okTexto = await correrEscenario({
    nombreEscenario: 'texto libre (el cliente escribe en vez de tocar la lista)',
    telefonoPrueba: '+56900000098',
    empresa,
    mensajes: [
      'Hola',
      'Quiero agendar una hora para el 4 de septiembre',
      'el examen visual',
      `me sirve a las ${primeraHora}`,
      ...(empresa.requiereRut ? [datosContacto] : []),
    ],
  });

  console.log('\n\n========== RESUMEN ==========');
  console.log('Tap de lista agendó:', okTap ? 'SÍ' : 'NO');
  console.log('Texto libre agendó:', okTexto ? 'SÍ' : 'NO');
}

main()
  .catch((err) => console.error('ERROR:', err))
  .finally(() => prisma.$disconnect());
