#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la plantilla de WhatsApp que usa
 * src/jobs/bloquearEmpresasVencidas.js para avisar a un negocio que su
 * prueba venció y sigue sin pagar. Alternativa a crearla a mano en
 * WhatsApp Manager (Meta Business Manager > cuenta del número demo >
 * Plantillas de mensajes) — hace exactamente lo mismo, por API.
 *
 * Requiere DEMO_WHATSAPP_ACCESS_TOKEN (ya en el entorno) y
 * DEMO_WHATSAPP_WABA_ID (el "ID de la cuenta de WhatsApp Business" del
 * número demo — no confundir con el phone_number_id). Se encuentra en:
 * Meta Business Manager > WhatsApp Manager > el número demo > Configuración
 * de la API > "ID de la cuenta de WhatsApp Business".
 *
 * Uso (Render Shell):
 *   node scripts/crear-plantilla-prueba-vencida.js
 *
 * Después de correrlo, la plantilla queda "En revisión" en WhatsApp Manager
 * — Meta tarda de un par de horas a 1-2 días en aprobarla o rechazarla. No
 * hace falta volver a correr este script salvo que la rechacen y haya que
 * reintentar con otro texto.
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
const NOMBRE_PLANTILLA = 'agendabot_prueba_vencida'; // debe coincidir con TEMPLATE_PRUEBA_VENCIDA en bloquearEmpresasVencidas.js

async function main() {
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.DEMO_WHATSAPP_WABA_ID;

  if (!accessToken) {
    console.error('Falta DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }
  if (!wabaId) {
    console.error('\nFalta DEMO_WHATSAPP_WABA_ID en el entorno.');
    console.error('Se encuentra en Meta Business Manager > WhatsApp Manager > el número demo >');
    console.error('Configuración de la API > "ID de la cuenta de WhatsApp Business" (NO es el phone_number_id).');
    console.error('Agrégalo en Render y volvé a correr este script.\n');
    process.exit(1);
  }

  const body = {
    name: NOMBRE_PLANTILLA,
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, tu período de prueba gratuita de AgendaBot terminó. Para que tus clientes puedan seguir agendando por WhatsApp sin interrupciones, activa tu plan aquí: {{2}}',
        example: {
          body_text: [['Óptica Ejemplo', 'https://agendabot-beryl.vercel.app/suscripcion/elegir-plan?empresaId=abc123']],
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
