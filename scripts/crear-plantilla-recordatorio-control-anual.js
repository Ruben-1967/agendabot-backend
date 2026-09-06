#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la plantilla que usa
 * jobs/enviarRecordatorios.js (recordatorio de control anual, rubro
 * óptica) — nunca se había creado en la WABA real de producción, solo
 * existía en la cuenta de prueba de Meta (encontrado 2026-09-06).
 *
 * Versión SIMPLE (sin botones) a propósito — la versión con botones
 * "Agendar"/"No por ahora" queda para más adelante; esta reemplaza esta
 * misma plantilla sin tocar código cuando esté lista y aprobada.
 *
 * Igual que scripts/crear-plantillas-recordatorio-cita.js: usa el
 * whatsappWabaId/whatsappToken ya guardados en la Empresa, así que no
 * hace falta ir a buscarlos a mano en Meta.
 *
 * Uso (Render Shell):
 *   EMPRESA_ID=<id> node scripts/crear-plantilla-recordatorio-control-anual.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLA = {
  name: 'recordatorio_control_anual',
  body: {
    text: 'Hola {{1}}, ya pasó un año desde tu último control de la vista en {{2}}. Te recomendamos agendar una nueva evaluación.',
    example: { body_text: [['María', 'Óptica Ejemplo']] },
  },
};

async function main() {
  const empresaId = process.env.EMPRESA_ID;
  if (!empresaId) {
    console.error('Uso: EMPRESA_ID=<id> node scripts/crear-plantilla-recordatorio-control-anual.js');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  if (!empresa.whatsappWabaId) {
    console.error(`${empresa.nombre} no tiene whatsappWabaId guardado — conéctala primero.`);
    process.exit(1);
  }
  const accessToken = empresa.whatsappToken;
  if (!accessToken) {
    console.error(`${empresa.nombre} no tiene whatsappToken guardado.`);
    process.exit(1);
  }

  console.log(`Empresa: ${empresa.nombre} (WABA ${empresa.whatsappWabaId})\n`);
  console.log(`Enviando a revisión "${PLANTILLA.name}"...`);

  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PLANTILLA.name,
      language: 'es',
      category: 'UTILITY',
      components: [{ type: 'BODY', ...PLANTILLA.body }],
    }),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error(`  ❌ Meta rechazó "${PLANTILLA.name}":`, JSON.stringify(datos, null, 2));
    process.exit(1);
  }
  console.log(`  ✅ Enviada:`, JSON.stringify(datos));
  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada" (horas a 1-2 días).');
}

main()
  .catch((error) => { console.error('ERROR:', error); process.exit(1); })
  .finally(() => prisma.$disconnect());
