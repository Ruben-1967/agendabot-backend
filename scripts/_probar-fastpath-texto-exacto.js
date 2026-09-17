#!/usr/bin/env node
// Prueba de humo del fast-path de texto exacto
// (chatbotEngine.js#intentarFastPathTexto, paso 8 del fix estructural --
// ver C:\Users\ruben\.claude\plans\clever-yawning-stearns.md). Confirma el
// caso que motivó la pregunta de diseño sin resolver de las 3 rondas de
// consulta con otras IAs: el cliente CONFIRMA por texto libre en vez de
// tocar (día, hora, nombre, confirmación final), y eso debe tratarse con
// la misma certeza que un tap -- nunca una interpretación adivinada.
// También incluye un caso negativo de regresión (encontrado en review
// 2026-09-17): "no se" no debe capturarse como si fuera un nombre.
//
// Usa el negocio de demo "Estudio Bella Piel" (solo existe en Staging).
// Necesita ANTHROPIC_API_KEY (redactarMensajePaso/generarRespuestaChatbot).
//
// USO (Shell de Staging):
//   node scripts/_probar-fastpath-texto-exacto.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarSeleccionInteractiva, procesarMensajeEntrante } = require('../src/services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');
const { fechaLegibleDesdeISO } = require('../src/lib/formatoFechas');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011133'; // fijo, rango de prueba -- nunca generado

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

  await limpiar();

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  if (!recurso) throw new Error('El negocio de demo no tiene RecursoAgendable configurado.');
  const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 1);
  if (dias.length === 0) throw new Error('El negocio de demo no tiene ningún día con cupo -- no se puede probar.');
  const fecha = dias[0].fecha;

  const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });
  const paramsBase = { empresa, telefonoCliente: TELEFONO, nombreContacto: 'Prueba Claude', canal: 'whatsapp' };

  let horaReal;
  let conv;

  if (serviciosReales.length > 1) {
    // 1a. Tap de SERVICIO -- dispara la lista de días automáticamente.
    await procesarSeleccionInteractiva({
      ...paramsBase, tipoSeleccion: 'servicio',
      valorDecodificado: { servicioId: serviciosReales[0].id, servicioNombre: serviciosReales[0].nombre },
    });

    // 1b. En vez de TOCAR el día, el cliente lo ESCRIBE tal cual como lo
    // vio en la fila de la lista -- mismo caso que la hora (paso 2), pero
    // para PEDIR_DIA (el que el review encontró efectivamente inalcanzable
    // antes de este fix, por no guardar la etiqueta legible).
    const fechaLegible = fechaLegibleDesdeISO(fecha);
    const rDia = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: fechaLegible, nombreContacto: 'Prueba Claude' });
    console.log(`BOT tras escribir el día "${fechaLegible}" en texto libre:`, rDia.respuestaTexto);
    conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
    assert('reservaEnCurso.fecha quedó guardada al ESCRIBIR el día exacto (fast-path de día)', conv?.reservaEnCurso?.fecha === fecha);
    horaReal = (conv.reservaEnCurso.opcionesMostradas || [])[0]?.valor;
  } else {
    // Negocio sin ambigüedad de servicio -- el fast-path de día solo tiene
    // sentido cuando ya hubo un tap/fast-path previo que mostrara la
    // lista, así que acá se prueba con el tap directo.
    await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
    conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
    horaReal = (conv.reservaEnCurso.opcionesMostradas || [])[0]?.valor;
  }
  if (!horaReal) throw new Error('No se guardó ninguna opción de hora en reservaEnCurso.opcionesMostradas.');

  // 2. En vez de TOCAR la hora, el cliente la ESCRIBE tal cual -- EL CASO
  // que quedó sin resolver en las 3 rondas de consulta con otras IAs.
  const r2 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: horaReal, nombreContacto: 'Prueba Claude' });
  console.log(`BOT tras escribir la hora "${horaReal}" en texto libre:`, r2.respuestaTexto);
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('reservaEnCurso.hora quedó guardada al ESCRIBIR la hora exacta (fast-path, sin pasar por Claude para decidir)', conv?.reservaEnCurso?.hora === horaReal);
  assert('la respuesta NO repite la lista de horarios', !/elige el que más te acomode/i.test(r2.respuestaTexto || ''));

  // 2.5. Caso negativo de regresión (hallazgo real de review 2026-09-17):
  // "no se" tiene la FORMA de un nombre (2 palabras, solo letras) pero
  // nunca lo es -- no debe capturarse con certeza de tap.
  const rNoSe = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'no se', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras "no se" (NO debe capturarse como nombre):', rNoSe.respuestaTexto);
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('"no se" no quedó guardado como reservaEnCurso.nombre (falso positivo evitado)', normalizaNombreGuardado(conv?.reservaEnCurso?.nombre) !== 'no se');

  // 3. El cliente escribe su nombre real en texto libre -- este negocio de
  // demo NO exige RUT, así que el nombre es el ÚLTIMO dato que faltaba:
  // reservaEnCurso pasa a CONFIRMAR y se agenda de inmediato, en el MISMO
  // turno (por diseño, ver plan del fix estructural: "si el paso es
  // CONFIRMAR con todos los datos, llama a crearCitaValidada directo" --
  // no hay un paso separado de "escribe dale para confirmar" cuando el tap/
  // fast-path ya completó todo).
  const r3 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'Rosa Levi Fuentes', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras escribir el nombre (debería agendar directo, sin pedir confirmación extra):', r3.respuestaTexto);
  assert('la respuesta ya confirma la cita agendada (nombre completó todos los datos)', /agendada exitosamente/i.test(r3.respuestaTexto || ''));

  const citaCreada = await prisma.cita.findFirst({ where: { clienteId: r3.cliente.id }, orderBy: { creadoEn: 'desc' } });
  assert('se creó una Cita real en la base', !!citaCreada);

  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('reservaEnCurso quedó en null tras agendar', conv?.reservaEnCurso === null);

  // 4. Un "dale" suelto DESPUÉS de que ya se agendó no debe crear una
  // segunda Cita ni reventar -- no hay nada pendiente que confirmar.
  const r4 = await procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'dale', nombreContacto: 'Prueba Claude' });
  console.log('BOT tras un "dale" suelto ya con la cita agendada:', r4.respuestaTexto);
  const citasTotales = await prisma.cita.count({ where: { clienteId: r4.cliente.id } });
  assert('un "dale" posterior NO crea una segunda Cita', citasTotales === 1);

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s) -- revisar arriba.`}`);
}

function normalizaNombreGuardado(nombre) {
  return (nombre || '').trim().toLowerCase();
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
