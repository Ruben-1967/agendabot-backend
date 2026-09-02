#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la plantilla de WhatsApp que usa
 * src/jobs/pausaCoexistence.js para avisar al negocio, por WhatsApp, que un
 * cliente pidió hablar con una persona y lleva 10+ min sin respuesta.
 * Mismo patrón que scripts/crear-plantilla-prueba-vencida.js.
 *
 * Requiere DEMO_WHATSAPP_ACCESS_TOKEN y DEMO_WHATSAPP_WABA_ID (mismo WABA
 * que ya usan los avisos de prueba vencida y activación de cuenta — no
 * confundir con WHATSAPP_WABA_ID genérico).
 *
 * Uso (Render Shell):
 *   node scripts/crear-plantilla-alerta-humano.js
 *
 * Después de correrlo, la plantilla queda "En revisión" en WhatsApp
 * Manager — Meta tarda de un par de horas a 1-2 días en aprobarla o
 * rechazarla.
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
// Debe coincidir con TEMPLATE_ALERTA_URGENTE en src/jobs/pausaCoexistence.js
const NOMBRE_PLANTILLA = 'alerta_cliente_pide_humano';

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

  // Tono neutro de aviso de estado, sin imperativos de "actívalo ya" — la
  // plantilla de prueba vencida (crear-plantilla-prueba-vencida.js) fue
  // rechazada dos veces por Meta (INCORRECT_CATEGORY) hasta sacarle ese
  // tono; reutilizamos la misma fórmula que sí pasó ("revisa ... cuando
  // puedas") para esta.
  const body = {
    name: NOMBRE_PLANTILLA,
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, un cliente ({{2}}) está esperando hablar con una persona en tu chat de AgendaBot. Revisa la conversación en {{3}} cuando puedas.',
        example: {
          body_text: [['Óptica Ejemplo', '+56912345678', 'https://agendabot-beryl.vercel.app/admin/chats']],
        },
      },
      {
        type: 'FOOTER',
        text: 'AgendaBot — MultiDigital',
      },
    ],
  };

  console.log(`Enviando a revisión la plantilla "${NOMBRE_PLANTILLA}" (WABA ${wabaId})...\n`);

  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(datos, null, 2));
    process.exit(1);
  }

  console.log('✅ Plantilla enviada a revisión:');
  console.log(JSON.stringify(datos, null, 2));
  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada".');
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
