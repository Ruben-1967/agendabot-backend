#!/usr/bin/env node
/**
 * Prueba puntual y aislada del envío real del recordatorio de control
 * anual — manda la plantilla `recordatorio_control_anual_v2` a UN teléfono
 * elegido a mano, sin tocar ningún Cliente ni correr el query real del
 * cron (jobs/enviarRecordatorios.js), para no arriesgar mandarle algo a
 * un paciente real de otra óptica que esté pendiente hoy.
 *
 * Uso:
 *   EMPRESA_ID=<id> TELEFONO=<569XXXXXXXX> node scripts/probar-envio-recordatorio.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../src/services/whatsapp');

const empresaId = process.env.EMPRESA_ID;
const telefono = process.env.TELEFONO;

if (!empresaId || !telefono) {
  console.error('Uso: EMPRESA_ID=<id> TELEFONO=<569XXXXXXXX> node scripts/probar-envio-recordatorio.js');
  process.exit(1);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { nombre: true, whatsappNumeroId: true, whatsappToken: true },
  });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  if (!empresa.whatsappNumeroId) {
    console.error(`${empresa.nombre} no tiene WhatsApp conectado.`);
    process.exit(1);
  }

  const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

  await sendWhatsAppTemplateMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: telefono,
    accessToken,
    templateName: 'recordatorio_control_anual_v2',
    variables: ['Prueba', empresa.nombre],
  });

  console.log(`Recordatorio de prueba enviado a ${telefono} desde ${empresa.nombre}.`);
}

main()
  .catch((error) => {
    console.error('Error enviando la prueba:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
