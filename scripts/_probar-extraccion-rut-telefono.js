#!/usr/bin/env node
// Prueba de humo de extraerRutYTelefono (claude.js) + su wiring en
// chatbotEngine.js (paso PEDIR_RUT, paso 9 del fix estructural -- ver
// C:\Users\ruben\.claude\plans\clever-yawning-stearns.md). Resuelve el
// vacío encontrado al probar el paso 8 en vivo: una vez que agendar_cita
// deje de ser una tool de Claude, un negocio que exige RUT (ej.
// Ahorróptica en producción) necesita ALGÚN camino para capturar RUT y
// teléfono desde texto libre sin volver a dejar que Claude decida el
// flujo completo.
//
// Usa el negocio de demo "Estudio Bella Piel" (solo existe en Staging),
// con requiereRut FORZADO a true temporalmente (se restaura al final,
// pase lo que pase). Necesita ANTHROPIC_API_KEY.
//
// USO (Shell de Staging):
//   node scripts/_probar-extraccion-rut-telefono.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarSeleccionInteractiva, procesarMensajeEntrante } = require('../src/services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011144'; // fijo, rango de prueba -- nunca generado (WhatsApp)
const TELEFONO_CONTACTO = '987654321'; // fijo, rango de prueba -- el "teléfono de contacto" que el script confirma en el paso RUT

let requiereRutOriginal = null;
let fallos = 0;
function assert(descripcion, condicion) {
  console.log(`${condicion ? '✅' : '⚠️ '} ${descripcion}`);
  if (!condicion) fallos++;
}

async function limpiarConversacion() {
  // Busca por AMBOS teléfonos posibles -- crearCitaValidada sobrescribe
  // Cliente.telefono con el teléfono de CONTACTO confirmado (comportamiento
  // heredado, no nuevo), así que tras un run exitoso el Cliente ya no
  // aparece por el teléfono de WhatsApp original.
  const clientes = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, telefono: { in: [TELEFONO, TELEFONO_CONTACTO] } },
  });
  for (const cliente of clientes) {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  }
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  for (const cliente of clientes) {
    await prisma.cliente.delete({ where: { id: cliente.id } }).catch(() => {});
  }
}

async function avanzarHastaPedirRut(empresa) {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 1);
  const fecha = dias[0].fecha;
  const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });
  const paramsBase = { empresa, telefonoCliente: TELEFONO, nombreContacto: 'Prueba Claude', canal: 'whatsapp' };

  if (serviciosReales.length > 1) {
    await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'servicio', valorDecodificado: { servicioId: serviciosReales[0].id, servicioNombre: serviciosReales[0].nombre } });
  }
  await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  const hora = (conv.reservaEnCurso.opcionesMostradas || [])[0]?.valor;
  await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora } });
  await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'Rosa Levi Fuentes', nombreContacto: 'Prueba Claude' });
}

async function main() {
  const empresaOriginal = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresaOriginal) {
    console.log('⏭️  Negocio de demo no encontrado -- este script solo corre en Staging.');
    return;
  }

  await limpiarConversacion();
  requiereRutOriginal = empresaOriginal.requiereRut;
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { requiereRut: true } });
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });

  await avanzarHastaPedirRut(empresa);
  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('con requiereRut=true, tras el nombre la reserva queda esperando RUT (no se agendó todavía)', !!conv?.reservaEnCurso && !conv.reservaEnCurso.rut);

  // 1. El cliente NO da ninguno de los 2 datos (sin "?" a propósito -- con
  // "?" se filtraría antes en esComandoGlobalOPregunta, y nunca llegaría a
  // ejercitar la rama de extraerRutYTelefono que responde en texto sin
  // llamar a la herramienta).
  const r1 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'todavía no tengo esos datos a mano', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras mensaje sin RUT ni teléfono en paso RUT:', r1.respuestaTexto);
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('sin RUT ni teléfono mencionados, no se capturó nada', !conv?.reservaEnCurso?.rut && !conv?.reservaEnCurso?.telefonoContacto);

  // 2. Solo el RUT, sin teléfono -- debe guardar el RUT y seguir pidiendo teléfono.
  const r2 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'mi rut es 12345678-5', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras dar solo el RUT:', r2.respuestaTexto);
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('el RUT quedó guardado y validado', conv?.reservaEnCurso?.rut === '12345678-5');
  assert('todavía NO se agendó (falta el teléfono)', !!conv?.reservaEnCurso);

  // 3. Ahora el teléfono -- con RUT+teléfono completos, debe agendar directo.
  const r3 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'mi teléfono es 987654321', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras dar el teléfono (debería agendar):', r3.respuestaTexto);
  assert('con RUT y teléfono completos, la respuesta confirma la cita agendada', /agendada exitosamente/i.test(r3.respuestaTexto || ''));

  const citaCreada = await prisma.cita.findFirst({ where: { clienteId: r3.cliente.id }, orderBy: { creadoEn: 'desc' } });
  assert('se creó una Cita real en la base', !!citaCreada);

  // Búsqueda por id, no por telefono: crearCitaValidada sobrescribe
  // Cliente.telefono con el teléfono de CONTACTO confirmado (comportamiento
  // heredado del bloque agendar_cita original, no nuevo de este refactor)
  // -- buscar por el TELEFONO de WhatsApp original ya no lo encuentra.
  const clienteFinal = await prisma.cliente.findUnique({ where: { id: r3.cliente.id } });
  assert('Cliente.rut quedó guardado', clienteFinal?.rut === '12345678-5');
  assert('Cliente.telefono quedó guardado (el de contacto, no el de WhatsApp)', clienteFinal?.telefono === '987654321');

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s) -- revisar arriba.`}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await limpiarConversacion();
    if (requiereRutOriginal !== null) {
      await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { requiereRut: requiereRutOriginal } }).catch(() => {});
    }
    await prisma.$disconnect();
  });
