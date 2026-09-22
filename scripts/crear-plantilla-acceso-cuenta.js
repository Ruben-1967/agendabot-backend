#!/usr/bin/env node
// Envía a revisión (vía Graph API) la plantilla "acceso_cuenta_totemsystem"
// en la WABA demo (DEMO_PHONE_NUMBER_ID/DEMO_WHATSAPP_ACCESS_TOKEN) --
// usada por src/routes/auth.js (activar-cuenta, solicitar-reset-password) y
// src/routes/demos.js (convertir-a-cliente-real) para cualquier link de
// acceso a cuenta. Antes esos 3 envíos eran texto libre, que WhatsApp solo
// permite dentro de la ventana de 24h desde el último mensaje del
// destinatario al bot -- fuera de esa ventana Meta lo rechaza en silencio
// (error 131047, "re-engagement message"). Caso real que lo confirmó:
// LuxVision, 2026-09-22, reset de contraseña nunca llegó.
//
// No requiere EMPRESA_ID -- a diferencia de crear-plantillas-recordatorio-cita.js
// (que crea plantillas en la WABA propia de cada negocio), esta va en la
// WABA de la PLATAFORMA (demos), compartida por todo el flujo de cuentas.
// Requiere DEMO_WHATSAPP_ACCESS_TOKEN y DEMO_WHATSAPP_WABA_ID (mismo WABA
// que ya usan los avisos de prueba vencida y activación de cuenta -- ver
// crear-plantilla-alerta-humano.js/crear-plantilla-prueba-vencida.js).
//
// Uso (Render Shell):
//   node scripts/crear-plantilla-acceso-cuenta.js

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLA = {
  name: 'acceso_cuenta_totemsystem',
  body: {
    text: 'Aquí tienes tu link de acceso a TotemSystem (válido por tiempo limitado): {{1}}\n\nSi no lo solicitaste tú, puedes ignorar este mensaje.',
    example: { body_text: [['https://agendabot-beryl.vercel.app/activar-cuenta?token=ejemplo']] },
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
  console.log('Mientras tanto, sigue existiendo el script de emergencia scripts/_generar-link-reset-manual.js para no depender de WhatsApp.');
}

main().catch((error) => { console.error('ERROR:', error); process.exit(1); });
