#!/usr/bin/env node
/**
 * Solo lectura: usa el endpoint /debug_token de Meta para ver a qué WABA(s)
 * está realmente asociado DEMO_WHATSAPP_ACCESS_TOKEN — más confiable que
 * adivinar navegando WhatsApp Manager, porque lo dice el token mismo.
 *
 * No modifica nada en Meta ni en la base de datos.
 *
 * Uso (Render Shell):
 *   node scripts/inspeccionar-token-demo.js
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const tokenAInspeccionar = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

  if (!tokenAInspeccionar) {
    console.error('Falta DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }

  // El token se inspecciona a sí mismo — evita depender de META_APP_ID/SECRET,
  // que resultaron ser de una App de Meta distinta a la que emitió este token
  // (error "(#100) App_id in the input_token did not match the Viewing App").
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(tokenAInspeccionar)}&access_token=${encodeURIComponent(tokenAInspeccionar)}`;

  const respuesta = await fetch(url);
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('❌ Meta rechazó la consulta:');
    console.error(JSON.stringify(datos, null, 2));
    console.error('\nSi el error es de permisos, probemos con GET /me?fields=id,name usando el mismo token, para al menos confirmar que el token está vivo.');
    process.exit(1);
  }

  console.log('\nInfo completa del token DEMO_WHATSAPP_ACCESS_TOKEN:\n');
  console.log(JSON.stringify(datos.data, null, 2));

  const scopesGranulares = datos.data?.granular_scopes || [];
  const scopeWaba = scopesGranulares.find((s) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging');

  if (scopeWaba && scopeWaba.target_ids?.length > 0) {
    console.log(`\n✅ WABA(s) a la que este token tiene acceso: ${scopeWaba.target_ids.join(', ')}`);
    console.log('Esa es la WHATSAPP_WABA_ID que hay que usar para la plantilla (no la que estaba antes).');
  } else {
    console.log('\n⚠️  No se encontraron scopes granulares con el WABA en la respuesta — revisa el JSON completo de arriba a mano.');
    console.log('Buscá "target_ids" bajo whatsapp_business_management o whatsapp_business_messaging.');
  }
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
