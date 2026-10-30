#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la plantilla del aviso a Rubén cuando alguien abre
 * una demo de muestras.multidigital.cl (ver src/routes/visitasDemo.js). Sale del número
 * de la plataforma (DEMO_*), igual que la alerta de cliente que pide humano.
 * El cuerpo no parte con una variable: Meta rechaza esas plantillas.
 * La 1.ª versión (aviso_visita_demo, 30-oct) la rechazó por INCORRECT_CATEGORY: el texto
 * tiene que leerse como alerta de actividad de una cuenta, no como un aviso suelto.
 *
 * Requiere DEMO_WHATSAPP_ACCESS_TOKEN y DEMO_WHATSAPP_WABA_ID.
 *
 * Uso (Render Shell):
 *   node scripts/crear-plantilla-aviso-visita-demo.js
 *
 * Después revisar el estado en WhatsApp Manager > Plantillas de mensajes.
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
// Debe coincidir con TEMPLATE_AVISO_VISITA en src/routes/visitasDemo.js
const NOMBRE_PLANTILLA = 'alerta_visita_demo';

async function main() {
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.DEMO_WHATSAPP_WABA_ID;
  if (!accessToken || !wabaId) {
    console.error('Faltan DEMO_WHATSAPP_ACCESS_TOKEN o DEMO_WHATSAPP_WABA_ID en el entorno.');
    process.exit(1);
  }

  const body = {
    name: NOMBRE_PLANTILLA,
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Alerta de actividad de tu cuenta Multidigital: tu página de demostración {{1}} registró su primera visita de hoy, desde un {{2}}.

Esta alerta se envía una vez al día por página.',
        example: { body_text: [['carima.html', 'celular']] },
      },
      { type: 'FOOTER', text: 'Multidigital' },
    ],
  };

  console.log(`Enviando a revisión la plantilla "${NOMBRE_PLANTILLA}" (WABA ${wabaId})...\n`);
  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  process.exit(1);
});
