#!/usr/bin/env node
// Prueba de humo del camino de tap determinístico
// (chatbotEngine.js#procesarSeleccionInteractiva, paso 5 del fix
// estructural "el bot pierde certeza al convertir taps en texto libre" --
// ver C:\Users\ruben\.claude\plans\clever-yawning-stearns.md). Confirma
// específicamente el bug real que originó todo el refactor: tocar una HORA
// después de tocar un DÍA no debe volver a mostrar la lista de horarios ni
// perder el progreso ya hecho -- y que completar todos los datos agenda la
// cita real de forma determinística, sin pasar por el pipeline agéntico
// para NINGUNA de esas transiciones (necesita ANTHROPIC_API_KEY solo para
// redactar preguntas de texto simple, como pedir el nombre -- no para
// decidir el flujo).
//
// Usa el negocio de demo "Estudio Bella Piel" (solo existe en Staging).
//
// USO (Shell de Staging):
//   node scripts/_probar-tap-dia-hora-servicio-no-pierde-hilo.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarSeleccionInteractiva } = require('../src/services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011122'; // fijo, rango de prueba -- nunca generado

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

  // 0. Si el negocio tiene 2+ servicios reales (ambigüedad real), primero
  // hay que tocar uno -- mismo orden que exige siguientePaso().
  if (serviciosReales.length > 1) {
    const r0 = await procesarSeleccionInteractiva({
      ...paramsBase,
      tipoSeleccion: 'servicio',
      valorDecodificado: { servicioId: serviciosReales[0].id, servicioNombre: serviciosReales[0].nombre },
    });
    console.log('BOT tras tap de servicio:', r0.respuestaTexto);
  }

  // 1. Tap de DÍA
  const r1 = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
  console.log('BOT tras tap de día:', r1.respuestaTexto);
  assert(
    'tras el tap de día, interactivo es una lista de horarios (o bloques)',
    r1.interactivo?.tipo === 'lista_horarios' || r1.interactivo?.tipo === 'horarios_por_bloque'
  );

  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('reservaEnCurso.fecha quedó guardada tras el tap de día', conv?.reservaEnCurso?.fecha === fecha);
  assert('reservaEnCurso.hora sigue vacía (todavía no se tocó ninguna hora)', !conv?.reservaEnCurso?.hora);

  const horaElegida = (conv.reservaEnCurso.opcionesMostradas || [])[0]?.valor;
  if (!horaElegida) throw new Error('No se guardó ninguna opción de hora en reservaEnCurso.opcionesMostradas.');

  // 2. Tap de HORA -- EL BUG REAL que originó el refactor: esto NO debe
  // volver a mostrar la lista de horarios ni preguntar el servicio de
  // nuevo, debe avanzar al siguiente dato que falte (nombre).
  const r2 = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora: horaElegida } });
  console.log('BOT tras tap de hora:', r2.respuestaTexto);

  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('reservaEnCurso.hora quedó guardada tras el tap de hora (bug real: antes volvía a mostrar la lista)', conv?.reservaEnCurso?.hora === horaElegida);
  assert('la respuesta NO repite la lista de horarios', !/elige el que más te acomode/i.test(r2.respuestaTexto || ''));
  assert('la respuesta NO vuelve a preguntar por el servicio', !/para cuál de estos servicios/i.test(r2.respuestaTexto || ''));

  // 3. Tap duplicado de la MISMA hora -- debe ser idempotente.
  await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora: horaElegida } });
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('tap duplicado de la misma hora: reservaEnCurso.hora no cambia', conv?.reservaEnCurso?.hora === horaElegida);

  // 4. Simula que el cliente ya dio su nombre (texto libre -- el fast-path
  // de texto es el paso 8, todavía no escrito) escribiendo reservaEnCurso
  // directo, y repite el tap de hora para verificar que, con todos los
  // datos completos, se agenda la cita real de forma determinística.
  const datosExtra = { nombre: 'Prueba Claude E2E' };
  if (empresa.requiereRut) {
    datosExtra.rut = '11111111-1';
    datosExtra.telefonoContacto = TELEFONO;
  }
  await prisma.conversacion.update({
    where: { id: conv.id },
    data: { reservaEnCurso: { ...conv.reservaEnCurso, ...datosExtra } },
  });

  const r4 = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora: horaElegida } });
  console.log('BOT tras completar todos los datos:', r4.respuestaTexto);
  assert('la respuesta final confirma la cita agendada', /agendada exitosamente/i.test(r4.respuestaTexto || ''));

  const citaCreada = await prisma.cita.findFirst({ where: { clienteId: r4.cliente.id }, orderBy: { creadoEn: 'desc' } });
  assert('se creó una Cita real en la base', !!citaCreada);
  assert('la Cita quedó en estado PENDIENTE', citaCreada?.estado === 'PENDIENTE');

  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('reservaEnCurso quedó en null tras agendar (no queda una reserva a medias)', conv?.reservaEnCurso === null);

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s) -- revisar arriba.`}`);
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
