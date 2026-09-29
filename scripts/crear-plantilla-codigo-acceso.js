#!/usr/bin/env node
// Envía a revisión (vía Graph API) la plantilla "agendabot_codigo_acceso" --
// categoría AUTHENTICATION, usada por src/routes/auth.js
// (POST /auth/solicitar-codigo, login sin contraseña) vía
// services/whatsapp.js#sendWhatsAppOtpMessage.
//
// AUTHENTICATION es una categoría especial de Meta: no lleva un `body.text`
// propio como una plantilla UTILITY normal -- Meta arma el texto solo, en
// el idioma de la plantilla, a partir de estos 3 componentes fijos. Mismo
// patrón ya probado y aprobado en el proyecto hermano Norman
// (norman-medicamentos/scripts/crear-plantillas-whatsapp.js,
// plantilla "norman_codigo_acceso").
//
// code_expiration_minutes tiene que calzar con CODIGO_EXPIRA_MINUTOS en
// src/routes/auth.js (hoy: 10).
//
// Misma WABA compartida que ya usa "acceso_cuenta_totemsystem" (ver
// crear-plantilla-acceso-cuenta.js) -- requiere DEMO_WHATSAPP_ACCESS_TOKEN
// y DEMO_WHATSAPP_WABA_ID.
//
// Uso (Render Shell):
//   node scripts/crear-plantilla-codigo-acceso.js

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLA = {
  name: 'agendabot_codigo_acceso',
  language: 'es',
  category: 'AUTHENTICATION',
  components: [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 10 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
  ],
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

  console.log(`Enviando a revisión "${PLANTILLA.name}" (AUTHENTICATION) en WABA ${wabaId}...`);
  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PLANTILLA.name,
      language: PLANTILLA.language,
      category: PLANTILLA.category,
      components: PLANTILLA.components,
    }),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error(`❌ Meta rechazó "${PLANTILLA.name}":`, JSON.stringify(datos, null, 2));
    console.error('\nSi el error menciona un límite de número/plantillas AUTHENTICATION, ver la nota');
    console.error('de MODO_PRUEBA_LOGIN en src/routes/auth.js -- ese caso bloqueó al proyecto hermano');
    console.error('Norman con su WABA de prueba; esta WABA es un número real en uso, así que no debería');
    console.error('aplicar el mismo límite, pero no se puede asumir sin intentarlo.');
    process.exit(1);
  }
  console.log('✅ Enviada:', JSON.stringify(datos));
  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada" (horas a 1-2 días).');
  console.log('Mientras tanto, MODO_PRUEBA_LOGIN=true deja probar todo el flujo sin depender de esto.');
}

main().catch((error) => { console.error('ERROR:', error); process.exit(1); });
