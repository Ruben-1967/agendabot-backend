#!/usr/bin/env node
/**
 * Reproduce en vivo, contra el motor real del bot (sin pasar por WhatsApp),
 * un intento de agendar para el 4 de septiembre de 2026 con Ahorróptica —
 * para diagnosticar por qué un cliente real no logró agendar esa fecha.
 *
 * No envía ningún WhatsApp real (no llama a services/whatsapp.js) — solo
 * llama a generarRespuestaChatbot(), el mismo motor que usa el webhook real,
 * con un teléfono de prueba fijo (nunca generado al azar). Crea un Cliente +
 * Conversacion + posible Cita de prueba en la base de PRODUCCIÓN, y los
 * borra al final.
 *
 * Uso (Shell de Render, producción): node scripts/_probar-agendamiento-sept4-claude.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { obtenerHorariosDisponibles, obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000099'; // fijo, nunca real, nunca generado al azar

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
  console.log('<<< BOT (texto):', resultado.texto);
  if (resultado.interactivo) console.log('<<< BOT (interactivo):', JSON.stringify(resultado.interactivo));
  historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
  historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  return resultado;
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  if (!empresa) throw new Error('No se encontró la empresa');
  console.log('Empresa:', empresa.nombre, '| requiereRut:', empresa.requiereRut);

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  console.log('Recurso:', recurso?.nombre, '| horizonteAgendaDias:', recurso?.horizonteAgendaDias);

  // Chequeo directo (sin pasar por el chat) de disponibilidad real el 4-sep-2026
  const horasDirecto = await obtenerHorariosDisponibles(recurso.id, '2026-09-04');
  console.log('\n[Chequeo directo] Horas disponibles 2026-09-04:', JSON.stringify(horasDirecto));
  const proximosDias = await obtenerProximosDiasConDisponibilidad(recurso.id, 7);
  console.log('[Chequeo directo] Próximos días con disponibilidad:', JSON.stringify(proximosDias.map((d) => d.fecha)));

  // Si por algún motivo ya existiera un Cliente real con este teléfono de
  // prueba (telefono no es @unique en el schema), NUNCA lo reutilizamos ni
  // lo tocamos — abortamos, para no arriesgarnos a limpiar al final datos
  // de un paciente real. Solo seguimos si es exactamente el de prueba de
  // una corrida anterior sin limpiar, o si no existe.
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  let clienteCreadoAhora = false;
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Ya existe un Cliente real con el teléfono de prueba ${TELEFONO_PRUEBA} (id ${cliente.id}, nombre "${cliente.nombre}") — abortando para no tocarlo. Cambia TELEFONO_PRUEBA por otro número y reintenta.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
    clienteCreadoAhora = true;
  }
  console.log('\nCliente de prueba:', cliente.id, clienteCreadoAhora ? '(recién creado)' : '(reutilizado de una corrida anterior)');

  const historial = [];
  await turno(historial, empresa, cliente, 'Hola');
  await turno(historial, empresa, cliente, 'Quiero agendar una hora para el 4 de septiembre');
  if (horasDirecto.length > 0) {
    await turno(historial, empresa, cliente, `Me sirve a las ${horasDirecto[0]}`);
  }
  if (empresa.requiereRut) {
    await turno(historial, empresa, cliente, 'Mi nombre es Prueba Claude, mi rut es 11111111-1 y mi teléfono de contacto es +56900000099');
  }

  const citaCreada = await prisma.cita.findFirst({
    where: { empresaId: EMPRESA_ID, clienteId: cliente.id, fechaHoraInicio: { gte: new Date('2026-09-04T00:00:00Z'), lt: new Date('2026-09-05T00:00:00Z') } },
  });
  console.log('\n¿Se creó la cita para el 4-sep-2026?', citaCreada ? `SÍ (id ${citaCreada.id}, estado ${citaCreada.estado})` : 'NO');

  // Limpieza
  await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('\nLimpieza completa (cliente/conversación/cita de prueba eliminados).');
}

main()
  .catch((err) => console.error('ERROR:', err))
  .finally(() => prisma.$disconnect());
