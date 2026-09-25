#!/usr/bin/env node
// Uso puntual: enviar un ejemplo REAL del recordatorio de confirmación de
// cita (con botones "Sí, confirmo"/"No puedo") al celular del usuario, para
// que vea cómo quedó tras el cutover del 2026-09-25 (ver
// confirmarCitasProximas.js / server.js). Usa datos de ejemplo, NO crea
// ninguna Cita ni Cliente real -- manda la plantilla directo por Graph API,
// mismo camino que usa el job real.
//
// USO (Shell de Render, producción):
//   node scripts/_probar-envio-recordatorio-botones-ahoroptica-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../src/services/whatsapp');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_DESTINO = '56984084321'; // dado por el usuario en el chat, 2026-09-25
const PLANTILLA_RECORDATORIO_BOTONES = 'confirmacion_cita_recordatorio_botones';
const BOTONES_CONFIRMACION = [{ payload: 'CONFIRMAR_CITA' }, { payload: 'CANCELAR_CITA' }];

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, sucursal: true, whatsappToken: true, whatsappNumeroId: true },
  });
  if (!empresa) throw new Error('No se encontró la Empresa de Ahorróptica');

  const accessToken = descifrarSiCorresponde(empresa.whatsappToken);
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;

  // Variables de ejemplo -- mismo orden que confirmarCitasProximas.js:
  // [nombreParaSaludo, nombreEmpresa, fechaLegible, horaLegible]
  const variables = ['Ejemplo', nombreEmpresa, '30 de septiembre', '11:00'];

  const resultado = await sendWhatsAppTemplateMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: TELEFONO_DESTINO,
    accessToken,
    templateName: PLANTILLA_RECORDATORIO_BOTONES,
    variables,
    botonesQuickReply: BOTONES_CONFIRMACION,
  });

  console.log('✅ Enviado. Respuesta de Meta:', JSON.stringify(resultado, null, 2));
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
