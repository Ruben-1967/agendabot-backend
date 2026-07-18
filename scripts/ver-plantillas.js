#!/usr/bin/env node
// Lista todas las plantillas de WhatsApp de la WABA configurada, con su
// estado actual (APPROVED, PENDING, REJECTED, PAUSED, etc.) — para no tener
// que entrar al dashboard de Meta a revisar una por una.
//
// USO:
//   node scripts/ver-plantillas.js
//
// Variables de entorno requeridas (ya deben existir en Render):
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_WABA_ID

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

async function verPlantillas() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;

  if (!accessToken) throw new Error('Falta la variable de entorno WHATSAPP_ACCESS_TOKEN');
  if (!wabaId) throw new Error('Falta la variable de entorno WHATSAPP_WABA_ID');

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const plantillas = data.data || [];

  if (plantillas.length === 0) {
    console.log('No hay ninguna plantilla registrada en esta WABA todavía.');
    return;
  }

  const iconos = {
    APPROVED: '✅',
    PENDING: '🕐',
    REJECTED: '❌',
    PAUSED: '⏸️',
    DISABLED: '🚫',
  };

  console.log(`\n${plantillas.length} plantilla(s) encontrada(s):\n`);
  for (const p of plantillas) {
    const icono = iconos[p.status] || '❔';
    console.log(`${icono} ${p.name}  —  ${p.status}  (${p.category}, ${p.language})`);
    if (p.status === 'REJECTED' && p.rejected_reason) {
      console.log(`   Motivo del rechazo: ${p.rejected_reason}`);
    }
  }
  console.log('');
}

verPlantillas().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});