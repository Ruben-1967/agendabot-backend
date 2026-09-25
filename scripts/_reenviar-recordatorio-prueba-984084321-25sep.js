#!/usr/bin/env node
// Uso puntual: el botón del recordatorio anterior ya quedó "usado" en
// WhatsApp (no se puede volver a tocar) -- reenvía la MISMA plantilla con
// botones frescos al teléfono de prueba, sin crear una Cita nueva (reusa la
// que ya existe, creada por _crear-cita-prueba-botones-984084321-25sep.js).
//
// USO (Shell de Render, producción):
//   node scripts/_reenviar-recordatorio-prueba-984084321-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../src/services/whatsapp');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const CLIENTE_ID = 'prueba-984084321-ahoroptica-botones';
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
  const cita = await prisma.cita.findFirst({ where: { clienteId: CLIENTE_ID, estado: 'PENDIENTE' } });
  if (!cita) throw new Error('No se encontró la cita de prueba -- ¿ya se borró? Corré primero _crear-cita-prueba-botones-984084321-25sep.js');

  const accessToken = descifrarSiCorresponde(empresa.whatsappToken);
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;
  const { fechaLegible, horaLegible } = formatearFechaHoraChile(cita.fechaHoraInicio);

  const resultado = await sendWhatsAppTemplateMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: TELEFONO_PRUEBA,
    accessToken,
    templateName: PLANTILLA_RECORDATORIO_BOTONES,
    variables: ['Ejemplo Botones', nombreEmpresa, fechaLegible, horaLegible],
    botonesQuickReply: BOTONES_CONFIRMACION,
  });
  console.log('✅ Recordatorio reenviado con botones frescos. Respuesta de Meta:', JSON.stringify(resultado, null, 2));
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
