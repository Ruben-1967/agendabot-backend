#!/usr/bin/env node
// Prueba del POST /web/flow-webhook-collect (cobro inicial combinado) con una base de datos y un
// Flow SIMULADOS en memoria: no toca ninguna base real, no llama a Flow, no manda WhatsApp.
// Cubre: camino feliz, aviso duplicado, rechazo de pago, monto distinto, rechazo explícito de Flow
// al crear el plan y el hosting (reintento reanudable, sin duplicar), y fallo de BD al anotar pagos.
// USO: node scripts/_probar-webhook-collect-web-29oct.js
process.env.BACKEND_URL = 'http://localhost:0';
process.env.FLOW_PLAN_ID_WEB_MENSUAL = 'plan-mensual';
process.env.FLOW_PLAN_ID_WEB_ANUAL = 'plan-anual';
process.env.FLOW_PLAN_ID_WEB_HOSTING = 'plan-hosting';
const assert = require('assert');
const path = require('path');

// ---- BD simulada ----
let sw;
let pagos;
let fallaPagoCreate = false;
function unica(clave) { const e = new Error('unique'); e.code = 'P2002'; e.meta = { target: clave }; return e; }
const fakePrisma = {
  suscripcionWeb: {
    findUnique: async ({ where }) => (where.ordenComercioCollectPendiente !== undefined
      ? (sw.ordenComercioCollectPendiente === where.ordenComercioCollectPendiente ? { ...sw } : null)
      : { ...sw }),
    findFirst: async () => ({ ...sw }),
    updateMany: async ({ where, data }) => {
      if (where.estado && sw.estado !== where.estado) return { count: 0 };
      Object.assign(sw, data); return { count: 1 };
    },
    update: async ({ data }) => { Object.assign(sw, data); return { ...sw }; },
  },
  pagoWeb: {
    create: async ({ data }) => {
      if (fallaPagoCreate) throw new Error('BD caida');
      if (pagos.find((p) => p.flowToken === data.flowToken)) throw unica('flowToken');
      const p = { id: `pago${pagos.length + 1}`, ...data }; pagos.push(p); return p;
    },
    findUnique: async ({ where }) => pagos.find((p) => p.flowToken === where.flowToken) || null,
  },
  clienteWeb: { findUnique: async () => null },
};

// ---- Flow simulado ----
let estadoFlow;
let creadas;
let rechazos; // cola de errores a lanzar en crearSuscripcionFlow
const fakeFlow = {
  consultarEstado: async () => estadoFlow,
  crearSuscripcionFlow: async (p) => {
    const err = rechazos.shift();
    if (err) throw err;
    creadas.push(p); return { subscriptionId: `sus_${creadas.length}` };
  },
};

const raiz = path.resolve(__dirname, '..');
require.cache[require.resolve(path.join(raiz, 'src/lib/prisma'))] = { id: 'prisma', filename: 'prisma', loaded: true, exports: fakePrisma };
require.cache[require.resolve(path.join(raiz, 'src/services/flowClient'))] = { id: 'flow', filename: 'flow', loaded: true, exports: fakeFlow };

const router = require('../src/routes/suscripcionWeb');
const capa = router.stack.find((l) => l.route && l.route.path === '/flow-webhook-collect');
const handler = capa.route.stack[0].handle;

async function llamar() {
  const res = { codigo: 200, status(c) { this.codigo = c; return this; }, send() { return this; } };
  await handler({ body: { token: 'tok1' } }, res);
  return res.codigo;
}

function nuevo(extra = {}) {
  sw = {
    id: 'sw1', plan: 'MENSUAL', estado: 'COBRANDO', razonSocial: 'Cliente Prueba', flowCustomerId: 'cus1',
    ordenComercioCollectPendiente: 'wc_abc', montoPlanCollect: 11781, montoHostingCollect: 24514,
    fechaInicioContrato: null, flowSubscriptionId: null, flowSubscriptionIdHosting: null, ...extra,
  };
  pagos = []; creadas = []; rechazos = []; fallaPagoCreate = false;
  estadoFlow = { estado: '2', monto: 36295, comercioOrden: 'wc_abc', fechaPago: '2026-10-29 12:00:00' };
}
const rechazoFlow = () => new Error('Flow error 400: plan invalido');
const timeout = () => new Error('network timeout');

(async () => {
  let n = 0;
  const caso = async (desc, fn) => { await fn(); n++; };

  await caso('camino feliz: 2 pagos, plan (31 d) + hosting (365 d), ACTIVA', async () => {
    nuevo();
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACTIVA');
    assert.deepStrictEqual(pagos.map((p) => `${p.tipo}:${p.monto}`).sort(), ['HOSTING:24514', 'PLAN:11781']);
    assert.strictEqual(creadas.length, 2);
    assert.strictEqual(creadas[0].planId, 'plan-mensual');
    assert.strictEqual(creadas[1].planId, 'plan-hosting');
    assert.ok(creadas[0].trialPeriodDays >= 28 && creadas[0].trialPeriodDays <= 31, `trial plan ${creadas[0].trialPeriodDays}`);
    assert.ok(creadas[1].trialPeriodDays >= 364 && creadas[1].trialPeriodDays <= 366, `trial hosting ${creadas[1].trialPeriodDays}`);
    assert.ok(sw.fechaInicioContrato);
  });

  await caso('plan anual: trial del plan ~365 d', async () => {
    nuevo({ plan: 'ANUAL' });
    await llamar();
    assert.strictEqual(creadas[0].planId, 'plan-anual');
    assert.ok(creadas[0].trialPeriodDays >= 364);
  });

  await caso('aviso duplicado: no crea nada más', async () => {
    nuevo(); await llamar();
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(creadas.length, 2); assert.strictEqual(pagos.length, 2);
  });

  await caso('pago rechazado (estado 3): vuelve a ACEPTADA y libera la orden', async () => {
    nuevo(); estadoFlow = { estado: '3', monto: 36295, comercioOrden: 'wc_abc' };
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACEPTADA'); assert.strictEqual(sw.ordenComercioCollectPendiente, null);
    assert.strictEqual(creadas.length, 0); assert.strictEqual(pagos.length, 0);
  });

  await caso('monto distinto al esperado: no activa nada', async () => {
    nuevo(); estadoFlow.monto = 1000;
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'COBRANDO'); assert.strictEqual(creadas.length, 0); assert.strictEqual(pagos.length, 0);
  });

  await caso('Flow rechaza crear el plan: 500, COBRANDO; el reintento completa sin duplicar pagos', async () => {
    nuevo(); rechazos.push(rechazoFlow());
    assert.strictEqual(await llamar(), 500);
    assert.strictEqual(sw.estado, 'COBRANDO'); assert.strictEqual(creadas.length, 0); assert.strictEqual(pagos.length, 2);
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACTIVA'); assert.strictEqual(creadas.length, 2); assert.strictEqual(pagos.length, 2);
  });

  await caso('Flow rechaza crear el hosting: el reintento NO vuelve a crear el plan', async () => {
    nuevo(); rechazos.push(null, rechazoFlow()); // 1.º (plan) ok, 2.º (hosting) rechazo
    assert.strictEqual(await llamar(), 500);
    assert.strictEqual(sw.estado, 'COBRANDO'); assert.strictEqual(creadas.length, 1); assert.ok(sw.flowSubscriptionId);
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACTIVA'); assert.strictEqual(creadas.length, 2);
    assert.deepStrictEqual(creadas.map((c) => c.planId), ['plan-mensual', 'plan-hosting']);
  });

  await caso('timeout ambiguo al crear el plan: 200, queda ACTIVANDO y no se reintenta solo', async () => {
    nuevo(); rechazos.push(timeout());
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACTIVANDO'); assert.strictEqual(creadas.length, 0);
    assert.strictEqual(await llamar(), 200); // aviso repetido
    assert.strictEqual(creadas.length, 0);
  });

  await caso('BD falla al anotar el pago: 500, revierte; el reintento completa', async () => {
    nuevo(); fallaPagoCreate = true;
    assert.strictEqual(await llamar(), 500);
    assert.strictEqual(sw.estado, 'COBRANDO'); assert.strictEqual(creadas.length, 0);
    fallaPagoCreate = false;
    assert.strictEqual(await llamar(), 200);
    assert.strictEqual(sw.estado, 'ACTIVA'); assert.strictEqual(creadas.length, 2); assert.strictEqual(pagos.length, 2);
  });

  await caso('orden desconocida y pagada: 404 para que Flow reintente', async () => {
    nuevo(); estadoFlow.comercioOrden = 'wc_otra';
    assert.strictEqual(await llamar(), 404);
  });

  console.log(`✅ ${n} casos OK`);
})().catch((e) => { console.error('❌', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exitCode = 1; });
