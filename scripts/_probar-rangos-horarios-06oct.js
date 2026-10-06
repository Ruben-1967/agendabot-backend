#!/usr/bin/env node
// Prueba de la lista de RANGOS horarios (2026-10-06, pedido de Ahorróptica):
// cuando un día tiene más de 10 horas, tocar el día muestra primero una
// lista de rangos ("09:00 a 11:00") y, al tocar uno, la lista de horas de
// ese rango -- ninguna hora queda oculta ni se obliga a escribirla. Ejercita
// el camino de tap determinístico (chatbotEngine.js#procesarSeleccionInteractiva)
// contra el negocio de demo "Estudio Bella Piel" (solo existe en Staging).
// No manda ningún WhatsApp.
//
// USO (Staging):
//   node scripts/_probar-rangos-horarios-06oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { procesarSeleccionInteractiva } = require('../src/services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, solo Staging)
const TELEFONO = '569000011133'; // fijo, rango de prueba -- nunca generado

let fallos = 0;
function assert(descripcion, condicion) {
  console.log(`${condicion ? '✅' : '⚠️ '} ${descripcion}`);
  if (!condicion) fallos++;
}

async function limpiar() {
  const cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) await prisma.cliente.delete({ where: { id: cliente.id } }).catch(() => {});
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

  const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 10);
  const diaLargo = dias.find((d) => d.horas.length > 10);
  if (!diaLargo) {
    console.log(`⏭️  Ninguno de los próximos días tiene más de 10 horas (máx. ${Math.max(0, ...dias.map((d) => d.horas.length))}) -- no se puede probar el caso de rangos aquí.`);
    return;
  }
  const fecha = diaLargo.fecha;
  console.log(`Día de prueba: ${fecha} con ${diaLargo.horas.length} horas libres.\n`);

  const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });
  const paramsBase = { empresa, telefonoCliente: TELEFONO, nombreContacto: 'Prueba Claude', canal: 'whatsapp' };

  if (serviciosReales.length > 1) {
    await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'servicio', valorDecodificado: { servicioId: serviciosReales[0].id, servicioNombre: serviciosReales[0].nombre } });
  }

  // 1. Tocar el día -> lista de RANGOS
  const rDia = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
  const inter = rDia.interactivo;
  assert('tocar el día devuelve una lista de RANGOS (lista_franjas)', inter?.tipo === 'lista_franjas');
  if (inter?.tipo !== 'lista_franjas') { console.log(JSON.stringify(inter)); return finalizar(); }
  assert('cada rango tiene como máximo 10 horas', inter.franjas.every((f) => f.horas.length <= 10));
  const todas = inter.franjas.flatMap((f) => f.horas);
  assert(`los rangos cubren TODAS las horas del día (${todas.length} de ${diaLargo.horas.length})`, todas.length === diaLargo.horas.length);
  assert('hay a lo más 10 rangos (filas de la lista)', inter.franjas.length <= 10);
  console.log(`   rangos: ${inter.franjas.map((f) => `${f.desde}-${f.hasta}(${f.horas.length})`).join(' | ')}`);

  let conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('opcionesMostradas guarda TODAS las horas del día (para poder teclear una)', (conv?.reservaEnCurso?.opcionesMostradas || []).length === diaLargo.horas.length);

  // 2. Tocar el SEGUNDO rango -> lista de horas de ese rango
  const franja = inter.franjas[Math.min(1, inter.franjas.length - 1)];
  const rFranja = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'franja', valorDecodificado: { fecha, desde: franja.desde, hasta: franja.hasta } });
  assert('tocar un rango devuelve la lista de horas (lista_horarios)', rFranja.interactivo?.tipo === 'lista_horarios');
  assert('las horas mostradas son exactamente las de ese rango', JSON.stringify(rFranja.interactivo?.horas) === JSON.stringify(franja.horas));
  assert('el texto menciona el rango elegido', (rFranja.respuestaTexto || '').includes(franja.desde) && (rFranja.respuestaTexto || '').includes(franja.hasta));
  conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  assert('opcionesMostradas sigue guardando TODAS las horas del día tras elegir un rango', (conv?.reservaEnCurso?.opcionesMostradas || []).length === diaLargo.horas.length);

  // 3. Tocar una hora del rango -> avanza (pide los datos), sin volver a mostrar horarios
  const hora = franja.horas[0];
  try {
    const rHora = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora } });
    assert('tocar una hora avanza al siguiente paso (no vuelve a mostrar horarios)', !['lista_horarios', 'lista_franjas'].includes(rHora.interactivo?.tipo));
    conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
    assert('la hora quedó en la reserva y el rango elegido se limpió', conv?.reservaEnCurso?.hora === hora && !conv?.reservaEnCurso?.franjaElegida);
  } catch (err) {
    // Pedir los datos tras la hora redacta con Claude: sin ANTHROPIC_API_KEY
    // (ej. Staging corrido en una máquina local) el turno falla antes de
    // guardar -- este último tramo solo se puede verificar en el Shell de
    // Staging, que sí tiene la clave.
    console.log(`ℹ️  Último tramo omitido: la redacción con Claude falló (${err.message.slice(0, 70)}...). Correr este script en el Shell de Staging para verificarlo completo.`);
  }

  await finalizar();
}

async function finalizar() {
  console.log(fallos === 0 ? '\n✅ Todo OK' : `\n⚠️  ${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await limpiar().catch(() => {});
    await prisma.$disconnect();
  });
