#!/usr/bin/env node
// Envía a revisión (vía Graph API) la plantilla "chequeo_salud_sistema" --
// usada por src/jobs/chequeoSaludDiario.js para avisar por WhatsApp SOLO
// cuando el chequeo diario (08:00 hora de Chile) encuentra algo mal. Va en
// la WABA demo (misma que activación de cuenta / reset de password), mismo
// patrón que scripts/crear-plantilla-acceso-cuenta.js.
//
// Requiere DEMO_WHATSAPP_ACCESS_TOKEN y DEMO_WHATSAPP_WABA_ID.
//
// Uso (Render Shell):
//   node scripts/crear-plantilla-chequeo-salud.js

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLA = {
  name: 'chequeo_salud_sistema',
  body: {
    text: '⚠️ El chequeo diario del sistema encontró {{1}} punto(s) a revisar. Detalle completo en los logs de Render (buscar "CHEQUEO-SALUD-DIARIO").',
    example: { body_text: [['2']] },
  },
};

async function main() {
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.DEMO_WHATSAPP_WABA_ID;
  if (!accessToken) {
    console.error('Falta DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }
  if (!wabaId) {
    console.error('Falta DEMO_WHATSAPP_WABA_ID en el entorno.');
    process.exit(1);
  }

  console.log(`Enviando a revisión "${PLANTILLA.name}" en WABA ${wabaId}...`);
  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
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
    console.error(`❌ Meta rechazó "${PLANTILLA.name}":`, JSON.stringify(datos, null, 2));
    process.exit(1);
  }
  console.log('✅ Enviada:', JSON.stringify(datos));
  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada" (horas a 1-2 días).');
  console.log('Hasta que se apruebe, el chequeo diario sigue corriendo y logueando en Render igual -- solo falta el aviso por WhatsApp.');
}

main().catch((error) => { console.error('ERROR:', error); process.exit(1); });
