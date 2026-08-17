#!/usr/bin/env node
/**
 * Solo lectura: comprueba si WHATSAPP_WABA_ID (usado por scripts/crear-plantilla.js
 * y scripts/ver-plantillas.js) es la misma cuenta de WhatsApp Business que
 * contiene el número demo (DEMO_PHONE_NUMBER_ID) — necesario saberlo antes
 * de enviar la plantilla de prueba vencida, porque tiene que quedar
 * aprobada en la WABA dueña del número que realmente la va a enviar.
 *
 * No modifica nada en Meta ni en la base de datos.
 *
 * Uso (Render Shell):
 *   node scripts/verificar-waba-demo.js
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const demoPhoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;

  if (!accessToken) {
    console.error('Falta WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }
  if (!wabaId) {
    console.error('Falta WHATSAPP_WABA_ID en el entorno — entonces no está configurada como creíamos.');
    process.exit(1);
  }
  if (!demoPhoneNumberId) {
    console.error('Falta DEMO_PHONE_NUMBER_ID en el entorno.');
    process.exit(1);
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`;

  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('❌ Meta rechazó la consulta (revisa que WHATSAPP_ACCESS_TOKEN tenga permiso whatsapp_business_management):');
    console.error(JSON.stringify(datos, null, 2));
    process.exit(1);
  }

  const numeros = datos.data || [];
  console.log(`\nNúmeros dentro de la WABA ${wabaId}:\n`);
  numeros.forEach((n) => {
    const esElDemo = n.id === demoPhoneNumberId;
    console.log(`${esElDemo ? '👉' : '  '} ${n.display_phone_number} (${n.verified_name || 'sin nombre verificado'}) — id: ${n.id}${esElDemo ? '  <-- ESTE ES DEMO_PHONE_NUMBER_ID' : ''}`);
  });

  const coincide = numeros.some((n) => n.id === demoPhoneNumberId);
  console.log(coincide
    ? '\n✅ SÍ: WHATSAPP_WABA_ID es la cuenta del número demo. Podés usar scripts/crear-plantilla.js tal cual (o el que armamos), sin variables nuevas.'
    : '\n❌ NO: el número demo no aparece en esta WABA. WHATSAPP_WABA_ID es de OTRA cuenta — hay que ubicar la WABA correcta del número demo en Meta Business Manager y usar ese ID en su lugar (no sirve enviar la plantilla a la WABA equivocada).');
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
