#!/usr/bin/env node
/**
 * Genera el link directo de Flow para que Diego (Ahorróptica) registre su
 * tarjeta y quede suscrito al Plan A con el precio pactado, sin entrar al
 * panel ni ver la pantalla de planes. Llama a nuestro propio POST
 * /suscripcion/elegir-plan (misma lógica de producción: crea el cliente en
 * Flow si falta, aplica el precio promocional vigente y arma la URL de
 * registro de tarjeta) y SOLO imprime el link si el monto es el esperado.
 *
 * Requiere haber corrido antes scripts/configurar-promo-ahoroptica-flow.js
 * con APLICAR=1. El link de Flow es de un solo uso y puede caducar: si
 * Diego lo abre tarde y falla, volver a correr este script y mandar el nuevo.
 *
 * Al registrar la tarjeta, Flow vuelve a nuestro callback, que cobra el
 * primer pago ($9.900, el hosting está exento) y activa la suscripción.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/generar-link-suscripcion-ahoroptica.js
 */

require('dotenv').config();

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const MONTO_ESPERADO = 9900;

async function main() {
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL en el entorno');

  const res = await fetch(`${process.env.BACKEND_URL}/suscripcion/elegir-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'A', empresaId: EMPRESA_ID }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`elegir-plan respondió ${res.status}: ${data.error || JSON.stringify(data)}`);

  console.log(`Monto que se va a cobrar: $${data.monto}`);
  if (data.monto !== MONTO_ESPERADO) {
    throw new Error(`El monto es $${data.monto}, no $${MONTO_ESPERADO} -- NO se muestra el link. ¿Se aplicó configurar-promo-ahoroptica-flow.js con APLICAR=1?`);
  }
  if (!data.url) throw new Error('La respuesta no trae url de registro de tarjeta');

  console.log('\nLink para Diego (registro de tarjeta en Flow):\n');
  console.log(data.url);
  console.log('');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exitCode = 1;
});
