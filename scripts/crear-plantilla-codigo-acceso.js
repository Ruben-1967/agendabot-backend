#!/usr/bin/env node
// Envía a revisión (vía Graph API) la plantilla "agendabot_codigo_acceso" --
// usada por src/routes/auth.js (POST /auth/solicitar-codigo, login sin
// contraseña) vía services/whatsapp.js#sendWhatsAppTemplateMessage.
//
// Categoría UTILITY, NO AUTHENTICATION: se intentó AUTHENTICATION primero
// (mismo patrón que el proyecto hermano Norman) y Meta la rechazó con
// error_subcode 2388185 ("does not have permission to create message
// template") -- AUTHENTICATION exige, además de verificación de negocio,
// un piso de volumen (1.000 "business-initiated dialogs"/día por número)
// que esta WABA compartida no alcanza. Se manda el código como texto {{1}}
// en una plantilla UTILITY normal, mismo patrón ya aprobado de
// "acceso_cuenta_totemsystem" (ver crear-plantilla-acceso-cuenta.js) -- se
// pierde el botón nativo "Copiar código" de WhatsApp, el resto es igual.
//
// Uso (Render Shell):
//   node scripts/crear-plantilla-codigo-acceso.js

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLA = {
  name: 'agendabot_codigo_acceso',
  body: {
    text: 'Tu código de acceso a TotemSystem es: {{1}}\n\nVence en 10 minutos. Si no lo solicitaste tú, puedes ignorar este mensaje.',
    example: { body_text: [['123456']] },
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

  console.log(`Enviando a revisión "${PLANTILLA.name}" (UTILITY) en WABA ${wabaId}...`);
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
  console.log('Mientras tanto, MODO_PRUEBA_LOGIN=true deja probar todo el flujo sin depender de esto.');
}

main().catch((error) => { console.error('ERROR:', error); process.exit(1); });
