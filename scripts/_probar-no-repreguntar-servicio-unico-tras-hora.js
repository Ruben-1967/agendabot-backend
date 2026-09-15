#!/usr/bin/env node
/**
 * Reproduce el bug real reportado en vivo (2026-09-17, captura de WhatsApp
 * real de Ahorróptica): el cliente dice "Examen visual" (no el nombre
 * EXACTO del único servicio real, "Evaluación examen visual"), elige día
 * y hora de las listas interactivas -- y justo cuando debería pedir el
 * nombre para agendar, el bot vuelve a preguntar "¿Para cuál de estos
 * servicios necesitas la hora?", descartando todo el progreso.
 *
 * Sigue la secuencia exacta de la captura real, incluyendo el mismo texto
 * sintético que server.js genera cuando el cliente TOCA un horario de la
 * lista (no lo escribe): 'Confirmo que quiero agendar para el ... a las
 * ...'.
 *
 * Mismo patrón seguro: teléfono de prueba fijo, guardia, limpieza.
 *
 * USO (Shell de Render, producción):
 *   node scripts/_probar-no-repreguntar-servicio-unico-tras-hora.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');
const { fechaLegibleDesdeISO } = require('../src/lib/formatoFechas');
const { obtenerProximosDiasConDisponibilidad, obtenerHorariosDisponibles } = require('../src/services/disponibilidad');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000503';

async function turno(historial, empresa, cliente, mensaje) {
  console.log(`\n>>> CLIENTE: ${mensaje}`);
  const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: mensaje });
  console.log('<<< BOT:', resultado.texto);
  if (resultado.interactivo) console.log('    interactivo:', resultado.interactivo.tipo);
  historial.push({ rol: 'usuario', contenido: mensaje, timestamp: new Date().toISOString() });
  historial.push({ rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() });
  return resultado;
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log('Empresa:', empresa.nombre);

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 3);
  if (dias.length === 0) throw new Error('No hay días con disponibilidad para probar -- ajustar el script.');
  const fechaISO = dias[0].fecha;
  const horas = await obtenerHorariosDisponibles(recurso.id, fechaISO);
  const hora = horas[0];
  console.log(`Usando fecha real disponible: ${fechaISO} ${hora}`);

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  try {
    await turno(historial, empresa, cliente, 'Hola');
    await turno(historial, empresa, cliente, 'Examen visual'); // NO es el nombre exacto a propósito
    // Simula el tap de un día de la lista (server.js manda solo la fecha,
    // no vuelve a mencionar el servicio).
    await turno(historial, empresa, cliente, `Confirmo que quiero ver los horarios para el ${fechaLegibleDesdeISO(fechaISO)} (${fechaISO}).`);
    // Simula el tap de una hora de la lista -- mismo texto sintético
    // exacto que arma server.js en el bloque de "cliente tocó un horario".
    const resultadoFinal = await turno(historial, empresa, cliente, `Confirmo que quiero agendar para el ${fechaLegibleDesdeISO(fechaISO)} (${fechaISO}) a las ${hora}.`);

    const volvioAPreguntarServicio = resultadoFinal.interactivo?.tipo === 'lista_servicios'
      || /para cu[aá]l de estos servicios/i.test(resultadoFinal.texto || '');
    console.log(volvioAPreguntarServicio
      ? '\n⚠️  FALLÓ: el bot volvió a preguntar por el servicio después de ya tener día y hora.'
      : '\n✅ El bot NO volvió a preguntar por el servicio -- avanzó normalmente (ej. pidiendo el nombre).');
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
