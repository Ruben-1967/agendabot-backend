#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la versión 2 de la plantilla de alerta
 * urgente — agrega un resumen de 1 línea de la conversación como 4ta
 * variable (ver resumirConversacionParaAlerta en jobs/pausaCoexistence.js).
 * Mismo cuerpo y tono que la v1 (ya aprobada), solo se agrega la línea de
 * resumen — para minimizar riesgo de rechazo por Meta.
 *
 * NO reemplaza la plantilla v1 (alerta_cliente_pide_humano), que sigue
 * activa mientras esta se revisa — ver TEMPLATE_ALERTA_URGENTE_V2 en
 * jobs/pausaCoexistence.js, todavía sin activar a propósito.
 *
 * Requiere DEMO_WHATSAPP_ACCESS_TOKEN y DEMO_WHATSAPP_WABA_ID.
 *
 * Uso (Render Shell):
 *   node scripts/crear-plantilla-alerta-humano-v2.js
 *
 * Después de correrlo, revisar el estado en WhatsApp Manager > Plantillas
 * de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada".
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
// Debe coincidir con TEMPLATE_ALERTA_URGENTE_V2 en src/jobs/pausaCoexistence.js
const NOMBRE_PLANTILLA = 'alerta_cliente_pide_humano_v2';

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

  const body = {
    name: NOMBRE_PLANTILLA,
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, un cliente ({{2}}) está esperando hablar con una persona en tu chat de AgendaBot.\n\nResumen: {{3}}\n\nRevisa la conversación en {{4}} cuando puedas.',
        example: {
          body_text: [[
            'Óptica Ejemplo',
            '+56912345678',
            'Pregunta por examen visual para el sábado, sin hora agendada.',
            'https://agendabot-beryl.vercel.app/admin/chats',
          ]],
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
  console.log('IMPORTANTE: no activar TEMPLATE_ALERTA_URGENTE_V2 en pausaCoexistence.js hasta confirmar que quedó "Aprobada".');
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
