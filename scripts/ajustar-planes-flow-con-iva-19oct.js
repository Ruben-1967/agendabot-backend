#!/usr/bin/env node
/**
 * Ajusta en Flow el monto de los planes de TotemSystem para que cobren neto + IVA
 * (decisión 2026-10-16/19: todos los precios se publican "+ IVA"; Flow cobra el
 * monto del plan tal cual, sin sumar IVA -- ver src/lib/iva.js). Los planes que
 * ya existen en Flow siguen con el monto NETO con el que se crearon:
 *   Plan A 14.900 -> 17.731 | B 24.900 -> 29.631 | C 59.900 -> 71.281 | D 149.900 -> 178.381
 *   Hosting anual -> monto actual x 1,19
 * El plan promocional de Ahorróptica NO se toca (ya cobra $11.781 con IVA).
 *
 * Por defecto es DRY-RUN: solo LEE cada plan en Flow, muestra monto actual vs
 * objetivo y cuántas suscripciones activas dependen de él. Con APLICAR=1 edita el
 * monto (POST /plans/edit, solo planId + amount). Se niega a aplicar si hay
 * clientes pagando algún plan (cambiaría lo que Flow les cobra en el próximo ciclo),
 * salvo FORZAR=1 (decisión consciente).
 *
 * No manda mensajes. No imprime credenciales.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/ajustar-planes-flow-con-iva-19oct.js
 *   APLICAR=1 node scripts/ajustar-planes-flow-con-iva-19oct.js
 */

require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { PLANES } = require('../src/services/contratoHtml');
const { conIva } = require('../src/lib/iva');
const { obtenerValorUfHoy } = require('../src/lib/uf');

const BASE = process.env.FLOW_ENDPOINT || 'https://api.flow.cl/api';
const API_KEY = process.env.FLOW_API_KEY;
const SECRET = process.env.FLOW_API_SECRET;

function firmar(params) {
  const cadena = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', SECRET).update(cadena).digest('hex');
}
async function flowGet(ruta, params) {
  const todos = { apiKey: API_KEY, ...params };
  const qs = new URLSearchParams({ ...todos, s: firmar(todos) });
  const r = await fetch(`${BASE}${ruta}?${qs}`);
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
  if (!API_KEY || !SECRET) throw new Error('Faltan FLOW_API_KEY / FLOW_API_SECRET en el entorno.');
  const aplicar = process.env.APLICAR === '1';
  const forzar = process.env.FORZAR === '1';

  // Plan de Flow -> { planId, objetivo(montoActual), suscriptores }
  const objetivos = [];
  for (const [planEnum, detalle] of Object.entries(PLANES)) {
    const letra = planEnum.replace('PLAN_', '');
    const planId = process.env[`FLOW_PLAN_ID_${letra}`];
    const suscriptores = await prisma.suscripcion.count({
      where: { plan: planEnum, tokenFlow: { not: null }, precioPromoFlowPlanId: null },
    });
    objetivos.push({ etiqueta: detalle.etiqueta, planId, objetivo: () => conIva(detalle.montoMensual), suscriptores, netoEsperado: detalle.montoMensual });
  }
  const suscriptoresHosting = await prisma.suscripcion.count({ where: { flowSubscriptionIdHosting: { not: null } } });
  // El hosting se calcula desde la UF de hoy (1 UF + IVA), NO desde el monto actual: así correr el
  // script dos veces (por ejemplo tras un fallo a medias) nunca multiplica el IVA otra vez.
  const montoHostingNuevo = conIva(await obtenerValorUfHoy());
  objetivos.push({ etiqueta: 'Hosting anual', planId: process.env.FLOW_PLAN_ID_HOSTING, objetivo: () => montoHostingNuevo, suscriptores: suscriptoresHosting, netoEsperado: null });

  const filas = [];
  for (const o of objetivos) {
    if (!o.planId) { filas.push({ ...o, error: 'sin FLOW_PLAN_ID en el entorno' }); continue; }
    const info = await flowGet('/plans/get', { planId: o.planId });
    if (info.code && info.message) { filas.push({ ...o, error: `Flow: ${info.message}` }); continue; }
    const actual = Number(info.amount);
    if (!Number.isFinite(actual)) { filas.push({ ...o, error: 'Flow no devolvió un monto numérico para este plan' }); continue; }
    filas.push({ ...o, actual, nuevo: o.objetivo(actual) });
  }

  console.log('Plan            | planId                        | actual   -> nuevo    | suscripciones que dependen');
  for (const f of filas) {
    console.log(`${f.etiqueta.padEnd(15)} | ${String(f.planId || '-').padEnd(29)} | ${f.error ? f.error : `${f.actual} -> ${f.nuevo}`.padEnd(18)} | ${f.suscriptores}`);
  }
  const alertas = filas.filter((f) => !f.error && f.netoEsperado && f.actual !== f.netoEsperado && f.actual !== conIva(f.netoEsperado));
  for (const f of alertas) console.warn(`⚠️  ${f.etiqueta}: el monto actual en Flow (${f.actual}) no es ni el neto (${f.netoEsperado}) ni el bruto (${conIva(f.netoEsperado)}). Revisar antes de aplicar.`);
  const yaAjustados = filas.filter((f) => !f.error && f.netoEsperado && f.actual === conIva(f.netoEsperado));
  for (const f of yaAjustados) console.log(`ℹ️  ${f.etiqueta} ya está en el monto con IVA: se omite.`);

  if (!aplicar) {
    console.log('\nDRY-RUN: no se cambió nada en Flow. Para aplicar: APLICAR=1');
    return;
  }
  if (filas.some((f) => f.error) || alertas.length) throw new Error('Hay planes con error o monto inesperado: no se aplica nada.');
  const conClientes = filas.filter((f) => f.suscriptores > 0 && f.actual !== f.nuevo);
  if (conClientes.length && !forzar) {
    throw new Error(`Hay clientes pagando: ${conClientes.map((f) => f.etiqueta).join(', ')}. Cambiar el monto les cambia el cobro del próximo ciclo. Si es lo que quieres: FORZAR=1.`);
  }
  for (const f of filas) {
    if (f.actual === f.nuevo) continue;
    const r = await flowPost('/plans/edit', { planId: f.planId, amount: f.nuevo });
    if (r.code && r.message) throw new Error(`Flow rechazó editar ${f.etiqueta}: ${r.message}`);
    const verificado = await flowGet('/plans/get', { planId: f.planId });
    if (Number(verificado.amount) !== f.nuevo) throw new Error(`Después de editar ${f.etiqueta}, Flow muestra ${verificado.amount} y se esperaba ${f.nuevo}. Revisar en Flow antes de seguir.`);
    console.log(`✅ ${f.etiqueta}: ${f.actual} -> ${verificado.amount}`);
  }

  // Los montos guardados en las suscripciones ya existentes (sin promo) seguían en neto: se
  // pasan a neto + IVA para que el panel y los correos de aviso muestren lo que realmente se cobra.
  for (const [planEnum, detalle] of Object.entries(PLANES)) {
    const r = await prisma.suscripcion.updateMany({
      where: { plan: planEnum, precioPromoFlowPlanId: null, exentoDePlan: false, montoMensualActual: detalle.montoMensual },
      data: { montoMensualActual: conIva(detalle.montoMensual) },
    });
    if (r.count) console.log(`✅ ${planEnum}: ${r.count} suscripción(es) con el monto guardado actualizado ${detalle.montoMensual} -> ${conIva(detalle.montoMensual)}`);
  }
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
