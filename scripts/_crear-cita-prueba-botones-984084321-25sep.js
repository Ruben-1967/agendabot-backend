#!/usr/bin/env node
// Uso puntual: crea un Cliente/Cita de PRUEBA (claramente marcados) en
// Ahorróptica, asociados al teléfono de prueba ya usado en sesiones
// anteriores (56984084321 -- ver scripts/_borrar-*-prueba-984084321.js) y
// manda el recordatorio con botones apuntando a esa cita real, para
// verificar el flujo end-to-end (botón -> encuentra citaPendiente ->
// confirma/cancela de verdad). esSobrecupo=true para no chocar con el
// EXCLUDE constraint de horario si ya hay algo agendado en ese bloque.
//
// Limpiar después con scripts/_borrar-citas-y-conversacion-prueba-984084321.js
// (ya existente) o el que se genere a continuación.
//
// USO (Shell de Render, producción):
//   node scripts/_crear-cita-prueba-botones-984084321-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../src/services/whatsapp');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '56984084321';
const PLANTILLA_RECORDATORIO_BOTONES = 'confirmacion_cita_recordatorio_botones';
const BOTONES_CONFIRMACION = [{ payload: 'CONFIRMAR_CITA' }, { payload: 'CANCELAR_CITA' }];

function formatearFechaHoraChile(fecha) {
  const fechaLegible = fecha.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' });
  const horaLegible = fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
  return { fechaLegible, horaLegible };
}

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, sucursal: true, whatsappToken: true, whatsappNumeroId: true },
  });
  if (!empresa) throw new Error('No se encontró la Empresa de Ahorróptica');

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
  if (!recurso) throw new Error('Ahorróptica no tiene ningún RecursoAgendable');

  const servicio = await prisma.servicio.findFirst({ where: { empresaId: EMPRESA_ID } });

  const cliente = await prisma.cliente.upsert({
    where: { id: 'prueba-984084321-ahoroptica-botones' },
    update: {},
    create: {
      id: 'prueba-984084321-ahoroptica-botones',
      empresaId: EMPRESA_ID,
      nombre: '[PRUEBA] Ejemplo Botones',
      telefono: TELEFONO_PRUEBA,
    },
  });

  const inicio = new Date();
  inicio.setDate(inicio.getDate() + 5);
  inicio.setHours(11, 0, 0, 0);
  const fin = new Date(inicio.getTime() + 30 * 60 * 1000);

  const cita = await prisma.cita.create({
    data: {
      empresaId: EMPRESA_ID,
      clienteId: cliente.id,
      recursoAgendableId: recurso.id,
      servicioId: servicio ? servicio.id : null,
      fechaHoraInicio: inicio,
      fechaHoraFin: fin,
      estado: 'PENDIENTE',
      confirmacionIntentos: 1,
      confirmacionUltimoEnvioEn: new Date(),
      esSobrecupo: true, // evita chocar con el EXCLUDE constraint de horario
      nombrePaciente: '[PRUEBA] Ejemplo Botones',
      origenCanal: 'panel',
    },
  });
  console.log(`✅ Cita de prueba creada: ${cita.id} (${inicio.toISOString()})`);

  const accessToken = descifrarSiCorresponde(empresa.whatsappToken);
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;
  const { fechaLegible, horaLegible } = formatearFechaHoraChile(inicio);
  console.log(`🔎 Variables calculadas -- fechaLegible="${fechaLegible}" horaLegible="${horaLegible}"`);

  const resultado = await sendWhatsAppTemplateMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: TELEFONO_PRUEBA,
    accessToken,
    templateName: PLANTILLA_RECORDATORIO_BOTONES,
    variables: ['Ejemplo Botones', nombreEmpresa, fechaLegible, horaLegible],
    botonesQuickReply: BOTONES_CONFIRMACION,
  });
  console.log('✅ Recordatorio (con cita real detrás) enviado. Respuesta de Meta:', JSON.stringify(resultado, null, 2));
  console.log('\nAhora toca un botón en WhatsApp -- debería confirmar/cancelar de verdad esta vez.');
  console.log(`Para limpiar después: cita.id=${cita.id}, cliente.id=${cliente.id}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
