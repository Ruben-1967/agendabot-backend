#!/usr/bin/env node
/**
 * Lista (y, con APLICAR=1, cancela) las suscripciones del entorno de PRUEBAS (sandbox) de
 * Flow. Existen para dejar de recibir los correos "Aviso de pago automático - cargo de
 * prueba" (Visa de prueba terminada en 6623) que quedaron de las pruebas de staging.
 *
 * SEGURIDAD: se niega a correr si FLOW_ENDPOINT no apunta a sandbox.flow.cl -- así es
 * imposible que toque la cuenta REAL de Multidigital (FLOW_ENDPOINT=https://www.flow.cl/api).
 * Solo habla con Flow; no toca la base de datos, no manda mensajes y no imprime credenciales.
 * Cancelar una suscripción no borra clientes ni planes.
 *
 * Correr desde el Shell del servicio de STAGING en Render (el que tiene las claves de
 * sandbox), no desde producción.
 *
 * Uso:
 *   node scripts/cancelar-suscripciones-prueba-flow-sandbox.js                    (solo lista)
 *   SOLO=sus_abc,sus_def APLICAR=1 node scripts/cancelar-suscripciones-prueba-flow-sandbox.js   (cancela esas)
 *   APLICAR=1 node scripts/cancelar-suscripciones-prueba-flow-sandbox.js          (cancela todas las listadas)
 */

require('dotenv').config();
const crypto = require('crypto');

const BASE = process.env.FLOW_ENDPOINT || '';
const API_KEY = process.env.FLOW_API_KEY;
const SECRET = process.env.FLOW_API_SECRET;
const LIMITE = 100;

function firmar(params) {
  const cadena = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', SECRET).update(cadena).digest('hex');
}
async function flowGet(ruta, params) {
  const todos = { apiKey: API_KEY, ...params };
  const r = await fetch(`${BASE}${ruta}?${new URLSearchParams({ ...todos, s: firmar(todos) })}`);
  return r.json();
}
async function flowPost(ruta, params) {
  const todos = { apiKey: API_KEY, ...params };
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...todos, s: firmar(todos) }),
  });
  return r.json();
}

async function main() {
  if (!/\/\/sandbox\.flow\.cl\//i.test(BASE)) {
    throw new Error('FLOW_ENDPOINT no apunta a sandbox.flow.cl: este script solo corre contra el entorno de PRUEBAS. No se hace nada.');
  }
  if (!API_KEY || !SECRET) throw new Error('Faltan FLOW_API_KEY / FLOW_API_SECRET (de sandbox) en el entorno.');
  const aplicar = process.env.APLICAR === '1';
  const solo = (process.env.SOLO || '').split(',').map((x) => x.trim()).filter(Boolean);

  const todas = [];
  for (let inicio = 0; ; inicio += LIMITE) {
    const r = await flowGet('/subscription/list', { start: inicio, limit: LIMITE });
    if (r.code && r.message) throw new Error(`Flow: ${r.message}`);
    todas.push(...(r.data || []));
    if (!r.hasMore) break;
  }
  const lista = solo.length ? todas.filter((s) => solo.includes(s.subscriptionId)) : todas;

  console.log(`Entorno: sandbox | ${todas.length} suscripción(es) en total, ${lista.length} seleccionada(s).\n`);
  for (const s of lista) {
    console.log(`- ${s.subscriptionId} | plan ${s.planId} | cliente ${s.customerId} | estado ${s.status} | creada ${s.created} | próx. cobro ${s.next_invoice_date || '-'} | cancelación ${s.cancel_date || s.subscription_end || '-'}`);
  }
  if (!aplicar) {
    console.log('\nDRY-RUN: no se canceló nada. Para cancelar: APLICAR=1 (opcional SOLO=sus_...,sus_... para elegir).');
    return;
  }
  let canceladas = 0;
  let omitidas = 0;
  for (const s of lista) {
    const r = await flowPost('/subscription/cancel', { subscriptionId: s.subscriptionId, at_period_end: 0 });
    if (r.code && r.message) {
      omitidas++;
      console.log(`  ↷ ${s.subscriptionId}: no se canceló (${r.message}) -- probablemente ya estaba cancelada.`);
    } else {
      canceladas++;
      console.log(`  ✅ ${s.subscriptionId} cancelada.`);
    }
  }
  console.log(`\n${canceladas} cancelada(s), ${omitidas} omitida(s).`);
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
