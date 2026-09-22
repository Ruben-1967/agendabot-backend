#!/usr/bin/env node
// Prueba puntual: el mismo número de WhatsApp agenda una cita para sí
// mismo y después otra para un familiar -- verifica que la primera cita
// NO quede corrompida con el nombre/rut de la segunda persona (bug real
// reportado 2026-09-22, ver memoria del proyecto).
//
// Usa el negocio de demo "Estudio Bella Piel" (solo Staging), con
// requiereRut FORZADO a true temporalmente (se restaura al final).
// Necesita ANTHROPIC_API_KEY.
//
// USO (Shell de Staging):
//   node scripts/_probar-mismo-telefono-dos-pacientes.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarSeleccionInteractiva, procesarMensajeEntrante } = require('../src/services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011155'; // fijo, rango de prueba -- nunca generado (WhatsApp)

let requiereRutOriginal = null;
let fallos = 0;
function assert(descripcion, condicion) {
  console.log(`${condicion ? '✅' : '⚠️ '} ${descripcion}`);
  if (!condicion) fallos++;
}

async function limpiar() {
  const cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.cliente.delete({ where: { id: cliente.id } }).catch(() => {});
  }
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
}

async function agendarUnaCita(empresa, nombrePersona, rutPersona, telefonoContacto) {
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 1);
  const fecha = dias[0].fecha;
  const paramsBase = { empresa, telefonoCliente: TELEFONO, nombreContacto: 'Prueba', canal: 'whatsapp' };

  // Igual que _probar-extraccion-rut-telefono.js: si el negocio demo tiene
  // 2+ servicios, hay que elegir uno antes de que el flujo acepte "dia".
  const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });
  if (serviciosReales.length > 1) {
    await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'servicio', valorDecodificado: { servicioId: serviciosReales[0].id, servicioNombre: serviciosReales[0].nombre } });
  }

  await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  const hora = (conv.reservaEnCurso.opcionesMostradas || [])[0]?.valor;
  await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora } });
  await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: nombrePersona, nombreContacto: 'Prueba' });
  const r = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: `mi rut es ${rutPersona} y mi teléfono es ${telefonoContacto}`, nombreContacto: 'Prueba' });
  return r;
}

async function main() {
  const empresaOriginal = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresaOriginal) {
    console.log('⏭️  Negocio de demo no encontrado -- este script solo corre en Staging.');
    return;
  }

  await limpiar();
  requiereRutOriginal = empresaOriginal.requiereRut;
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { requiereRut: true } });
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });

  // 1. Agenda para sí mismo.
  const r1 = await agendarUnaCita(empresa, 'Pedro Soto Lira', '11111111-1', '911111111');
  const cita1Ok = /agendada exitosamente/i.test(r1.respuestaTexto || '');
  assert('primera cita (para sí mismo) se agendó', cita1Ok);
  if (!cita1Ok) {
    console.log('   Respuesta real del bot:', JSON.stringify(r1.respuestaTexto));
    throw new Error('No se pudo agendar la primera cita -- abortando antes de intentar la segunda.');
  }
  const cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  const cita1 = await prisma.cita.findFirst({ where: { clienteId: cliente.id }, orderBy: { creadoEn: 'asc' } });
  assert('Cita 1 tiene el nombre correcto en el momento de crearse', cita1?.nombrePaciente === 'Pedro Soto Lira');

  // 2. En la MISMA conversación (mismo teléfono), agenda para su hija.
  const r2 = await agendarUnaCita(empresa, 'Camila Soto Muñoz', '22222222-2', '922222222');
  assert('segunda cita (para la hija) se agendó', /agendada exitosamente/i.test(r2.respuestaTexto || ''));

  // 3. El caso real reportado: ¿la Cita 1 (papá) quedó corrompida con el
  // nombre/rut de la hija?
  const cita1Releida = await prisma.cita.findUnique({ where: { id: cita1.id } });
  assert('Cita 1 SIGUE con el nombre del papá (no se corrompió)', cita1Releida.nombrePaciente === 'Pedro Soto Lira');
  assert('Cita 1 SIGUE con el rut del papá (no se corrompió)', cita1Releida.rutPaciente === '11111111-1');

  const cita2 = await prisma.cita.findFirst({ where: { clienteId: cliente.id }, orderBy: { creadoEn: 'desc' } });
  assert('Cita 2 tiene el nombre de la hija', cita2.nombrePaciente === 'Camila Soto Muñoz');
  assert('Cita 2 tiene el rut de la hija', cita2.rutPaciente === '22222222-2');
  assert('las 2 citas son del MISMO Cliente (mismo teléfono, sin duplicar)', cita1Releida.clienteId === cita2.clienteId);

  const clienteFinal = await prisma.cliente.findUnique({ where: { id: cliente.id } });
  assert('Cliente.nombre quedó fijo con el PRIMER nombre (papá) -- ya no se sobrescribe', clienteFinal.nombre === 'Pedro Soto Lira');
  assert('Cliente.telefono sigue siendo el de WhatsApp (inmutable)', clienteFinal.telefono === TELEFONO);

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s) -- revisar arriba.`}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await limpiar();
    if (requiereRutOriginal !== null) {
      await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { requiereRut: requiereRutOriginal } }).catch(() => {});
    }
    await prisma.$disconnect();
  });
