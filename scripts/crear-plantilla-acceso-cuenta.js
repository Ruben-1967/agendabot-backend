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
// El whatsapp_business_account id se resuelve solo desde el
// DEMO_PHONE_NUMBER_ID -- no hace falta pegarlo a mano.
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
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    console.error('Faltan DEMO_PHONE_NUMBER_ID o DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }

  console.log('Resolviendo whatsapp_business_account desde el phone_number_id...');
  const respuestaPhone = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=whatsapp_business_account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const datosPhone = await respuestaPhone.json();
  if (!respuestaPhone.ok) {
    console.error('❌ No se pudo resolver el WABA:', JSON.stringify(datosPhone, null, 2));
    process.exit(1);
  }
  const wabaId = datosPhone.whatsapp_business_account?.id;
  if (!wabaId) {
    console.error('❌ La respuesta no trajo whatsapp_business_account.id:', JSON.stringify(datosPhone, null, 2));
    process.exit(1);
  }
  console.log(`WABA resuelto: ${wabaId}\n`);

  console.log(`Enviando a revisión "${PLANTILLA.name}"...`);
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
