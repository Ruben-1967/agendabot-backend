#!/usr/bin/env node
// Prueba de humo específica del bug crítico encontrado en review
// 2026-09-17 (paso 9 del fix estructural, ver
// C:\Users\ruben\.claude\plans\clever-yawning-stearns.md): cuando el
// cliente nombra el servicio en PROSA (sin tocar la lista) y Claude llama
// directo a consultar_disponibilidad -- saltándose mostrar_lista_servicios,
// justo lo que el system prompt le pide hacer en ese caso -- el
// servicioId resuelto se descartaba y reservaEnCurso quedaba con
// PEDIR_SERVICIO mal calculado. La siguiente hora exacta que el cliente
// escribiera se malinterpretaba como si fuera el nombre del servicio.
//
// Usa el negocio de demo "Estudio Bella Piel" (2 servicios reales, la
// ambigüedad real que dispara el bug) -- solo existe en Staging. Necesita
// ANTHROPIC_API_KEY.
//
// USO (Shell de Staging):
//   node scripts/_probar-servicio-nombrado-en-prosa-no-se-pierde.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarMensajeEntrante } = require('../src/services/chatbotEngine');
const { fechaLegibleDesdeISO } = require('../src/lib/formatoFechas');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011155'; // fijo, rango de prueba -- nunca generado

let fallos = 0;
function assert(descripcion, condicion) {
  console.log(`${condicion ? '✅' : '⚠️ '} ${descripcion}`);
  if (!condicion) fallos++;
}

async function limpiar() {
  const cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  }
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) {
    await prisma.cliente.delete({ where: { id: cliente.id } }).catch(() => {});
  }
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) {
    console.log('⏭️  Negocio de demo no encontrado -- este script solo corre en Staging.');
    return;
  }

  const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });
  if (serviciosReales.length < 2) {
    console.log('⏭️  Este negocio ya no tiene 2+ servicios reales -- no se puede reproducir la ambigüedad del bug.');
    return;
  }
  const servicioObjetivo = serviciosReales[1]; // el que NO es el primero, para no confundir con defaults

  // Este negocio de demo tiene requiereProfesionalEspecifico=true en sus
  // Servicio -- la disponibilidad se calcula por el recurso fijo vinculado
  // (ServicioRecurso), no por "cualquier profesional".
  const vinculo = await prisma.servicioRecurso.findFirst({ where: { servicioId: servicioObjetivo.id } });
  if (!vinculo) throw new Error(`El servicio "${servicioObjetivo.nombre}" no tiene ningún RecursoAgendable vinculado -- no se puede probar.`);
  const dias = await obtenerProximosDiasConDisponibilidad(vinculo.recursoAgendableId, 1);
  if (dias.length === 0) throw new Error(`El servicio "${servicioObjetivo.nombre}" no tiene ningún día con cupo -- no se puede probar.`);
  const fecha = dias[0].fecha;
  const fechaLegible = fechaLegibleDesdeISO(fecha);

  await limpiar();

  // 1. El cliente nombra el SERVICIO y el DÍA en el mismo mensaje, en
  // prosa -- nunca toca nada. Claude debería llamar directo a
  // consultar_disponibilidad (el system prompt se lo exige apenas sabe el
  // servicio), mostrando la lista real de horas para ESE servicio.
  const r1 = await procesarMensajeEntrante({
    empresa, telefonoCliente: TELEFONO, nombreContacto: 'Prueba Claude',
    textoEntrante: `Hola, quiero agendar ${servicioObjetivo.nombre} para el ${fechaLegible}`,
  });
  console.log('BOT tras nombrar servicio+día en prosa:', r1.respuestaTexto);

  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert(
    `reservaEnCurso.servicioId quedó sembrado con el servicio real "${servicioObjetivo.nombre}" (EL BUG: antes quedaba sin sembrar)`,
    conv?.reservaEnCurso?.servicioId === servicioObjetivo.id
  );
  assert('reservaEnCurso.fecha quedó sembrada', conv?.reservaEnCurso?.fecha === fecha);

  const horaReal = (conv?.reservaEnCurso?.opcionesMostradas || []).find((o) => /^\d{2}:\d{2}$/.test(o.valor))?.valor;
  if (!horaReal) {
    console.log('⚠️  No se guardó ninguna opción de hora en reservaEnCurso.opcionesMostradas -- revisar manualmente la respuesta de arriba.');
    fallos++;
  } else {
    // 2. El cliente escribe la hora EXACTA -- EL BUG: esto se malinterpretaba
    // como si fuera el nombre del servicio, escribiendo servicioId="10:00".
    const r2 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: horaReal, nombreContacto: 'Prueba Claude' });
    console.log(`BOT tras escribir la hora "${horaReal}":`, r2.respuestaTexto);

    conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
    assert('reservaEnCurso.hora quedó guardada como HORA (no como servicioId)', conv?.reservaEnCurso?.hora === horaReal);
    assert('reservaEnCurso.servicioId SIGUE siendo el servicio real (no se sobrescribió con la hora)', conv?.reservaEnCurso?.servicioId === servicioObjetivo.id);
    assert('la respuesta no vuelve a preguntar por el servicio', !/para cuál de estos servicios/i.test(r2.respuestaTexto || ''));

    // 3. Nombre -> debería completar y agendar (este negocio no exige RUT).
    const r3 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'Camila Rojas Díaz', nombreContacto: 'Prueba Claude' });
    console.log('BOT tras dar el nombre:', r3.respuestaTexto);
    assert('la cita quedó agendada', /agendada exitosamente/i.test(r3.respuestaTexto || ''));
    assert(`la confirmación menciona el servicio correcto ("${servicioObjetivo.nombre}"), no la hora`, (r3.respuestaTexto || '').includes(servicioObjetivo.nombre));

    const citaCreada = await prisma.cita.findFirst({ where: { clienteId: r3.cliente.id }, orderBy: { creadoEn: 'desc' } });
    assert('la Cita real quedó con el servicioId correcto', citaCreada?.servicioId === servicioObjetivo.id);
  }

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK -- el bug crítico queda cerrado.' : `${fallos} fallo(s) -- revisar arriba.`}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await limpiar();
    await prisma.$disconnect();
  });
