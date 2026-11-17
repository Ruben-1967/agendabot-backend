#!/usr/bin/env node
/**
 * Plan B de TotemSystem: de $24.900 a $29.900 + IVA al mes (decisión de Rubén,
 * 17-nov-2026). PLANES (src/services/contratoHtml.js) ya dice 29.900; esto
 * ajusta el plan en Flow (FLOW_PLAN_ID_B) a 29.900 + IVA = 35.581.
 *
 * Solo toca el Plan B. Por defecto es DRY-RUN: lee el plan en Flow y cuenta
 * cuántos clientes lo pagan. Con APLICAR=1 edita el monto, pero se niega si hay
 * suscripciones pagando el Plan B (les cambiaría el cobro del próximo ciclo;
 * además Flow solo deja editar el monto de un plan sin suscriptores).
 * No manda mensajes. No imprime credenciales.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_plan-b-29900-flow-17nov.js
 *   APLICAR=1 node scripts/_plan-b-29900-flow-17nov.js
 */

require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { PLANES } = require('../src/services/contratoHtml');
const { conIva } = require('../src/lib/iva');

const BASE = process.env.FLOW_ENDPOINT || 'https://api.flow.cl/api';
const API_KEY = process.env.FLOW_API_KEY;
const SECRET = process.env.FLOW_API_SECRET;
const PLAN_ID = process.env.FLOW_PLAN_ID_B;

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
  if (!API_KEY || !SECRET || !PLAN_ID) throw new Error('Faltan FLOW_API_KEY / FLOW_API_SECRET / FLOW_PLAN_ID_B en el entorno.');
  if (PLANES.PLAN_B.montoMensual !== 29900) throw new Error(`PLANES.PLAN_B dice ${PLANES.PLAN_B.montoMensual}: este deploy no trae el cambio a 29.900.`);
  const objetivo = conIva(PLANES.PLAN_B.montoMensual);

  const info = await flowGet('/plans/get', { planId: PLAN_ID });
  if (info.code && info.message) throw new Error(`Flow: ${info.message}`);
  const actual = Number(info.amount);
  const pagando = await prisma.suscripcion.count({ where: { plan: 'PLAN_B', estado: { in: ['ACTIVA', 'PAUSADA_POR_IMPAGO'] } } });
  const conFlow = await prisma.suscripcion.count({ where: { plan: 'PLAN_B', tokenFlow: { not: null } } });

  console.log(`Plan B en Flow (${PLAN_ID}): ${actual} -> ${objetivo} (29.900 + IVA).`);
  console.log(`Suscripciones Plan B activas o pausadas: ${pagando}. Con suscripción en Flow: ${conFlow}.`);
  if (actual === objetivo) { console.log('ℹ️  Flow ya tiene el monto nuevo. Nada que hacer.'); return; }

  if (process.env.APLICAR !== '1') {
    console.log('\nDRY-RUN: no se cambió nada en Flow. Para aplicar: APLICAR=1 node scripts/_plan-b-29900-flow-17nov.js');
    return;
  }
  if (conFlow > 0) throw new Error('Hay clientes con el Plan B en Flow: no se edita el monto (les cambiaría el cobro). Decidir caso a caso.');

  const r = await flowPost('/plans/edit', { planId: PLAN_ID, amount: objetivo });
  if (r.code && r.message) throw new Error(`Flow rechazó editar el Plan B: ${r.message}`);
  const verificado = await flowGet('/plans/get', { planId: PLAN_ID });
  if (Number(verificado.amount) !== objetivo) throw new Error(`Flow muestra ${verificado.amount} y se esperaba ${objetivo}. Revisar en Flow.`);
  console.log(`✅ Plan B en Flow: ${actual} -> ${verificado.amount}.`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
