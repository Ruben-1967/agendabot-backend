#!/usr/bin/env node
// Prueba del POST /web/flow-webhook-collect (cobro inicial combinado) con una base de datos y un
// Flow SIMULADOS en memoria: no toca ninguna base real, no llama a Flow, no manda WhatsApp.
// Cubre: camino feliz, aviso duplicado, rechazo de pago (con alerta por correo), monto distinto,
// rechazo explícito de Flow al crear el plan y el hosting (reintento reanudable, sin duplicar), fallo
// de BD al anotar pagos, y el revisor periódico (Flow no avisa los rechazos).
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
    findMany: async ({ where }) => {
      const ok = sw.estado === where.estado && sw.ordenComercioCollectPendiente !== null
        && sw.actualizadoEn < where.actualizadoEn.lt;
      return ok ? [{ ...sw }] : [];
    },
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
  consultarEstadoPorCommerceId: async () => estadoFlow,
  crearSuscripcionFlow: async (p) => {
    const err = rechazos.shift();
    if (err) throw err;
    creadas.push(p); return { subscriptionId: `sus_${creadas.length}` };
  },
};

let alertas = [];
let alertasSinResolver = [];
const fakeAlerta = {
  enviarAlertaCobroRechazado: async (d) => { alertas.push(d); },
  enviarAlertaCobroSinResolver: async (d) => { alertasSinResolver.push(d); },
};

const raiz = path.resolve(__dirname, '..');
require.cache[require.resolve(path.join(raiz, 'src/services/emailAlertaCobroWeb'))] = { id: 'alerta', filename: 'alerta', loaded: true, exports: fakeAlerta };
require.cache[require.resolve(path.join(raiz, 'src/lib/prisma'))] = { id: 'prisma', filename: 'prisma', loaded: true, exports: fakePrisma };
require.cache[require.resolve(path.join(raiz, 'src/services/flowClient'))] = { id: 'flow', filename: 'flow', loaded: true, exports: fakeFlow };

const router = require('../src/routes/suscripcionWeb');
const { reconciliarCobrosInicialesWeb, procesarEstadoCobroInicial } = require('../src/lib/cobroInicialWeb');
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
    fechaInicioContrato: null, flowSubscriptionId: null, flowSubscriptionIdHosting: null,
    emailAceptacion: 'cliente@ejemplo.cl', tarjetaUltimos4: '1781', ref: 'refabc', plan2: null,
    actualizadoEn: new Date(Date.now() - 60 * 60 * 1000), ...extra,
  };
  pagos = []; creadas = []; rechazos = []; fallaPagoCreate = false; alertas = []; alertasSinResolver = [];
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
    assert.strictEqual(alertas.length, 1); assert.strictEqual(alertas[0].monto, 36295);
    assert.strictEqual(await llamar(), 200); assert.strictEqual(alertas.length, 1); // aviso repetido: sin 2.ª alerta
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

  await caso('revisor: Flow dice RECHAZADO -> ACEPTADA y 1 alerta (Flow nunca avisó)', async () => {
    nuevo(); estadoFlow = { estado: 3, monto: '36295', comercioOrden: 'wc_abc' };
    const r = await reconciliarCobrosInicialesWeb();
    assert.strictEqual(r.rechazadas, 1);
    assert.strictEqual(sw.estado, 'ACEPTADA'); assert.strictEqual(sw.ordenComercioCollectPendiente, null);
    assert.strictEqual(alertas.length, 1);
    assert.deepStrictEqual(await reconciliarCobrosInicialesWeb(), { revisadas: 0, activadas: 0, rechazadas: 0, pendientes: 0, errores: 0 });
  });

  await caso('revisor: Flow dice PAGADO -> activa igual que el webhook, sin duplicar si llega el webhook despues', async () => {
    nuevo(); estadoFlow = { estado: 2, monto: '36295', comercioOrden: 'wc_abc', fechaPago: '2026-10-29 12:00:00' };
    const r = await reconciliarCobrosInicialesWeb();
    assert.strictEqual(r.activadas, 1);
    assert.strictEqual(sw.estado, 'ACTIVA'); assert.strictEqual(creadas.length, 2); assert.strictEqual(pagos.length, 2);
    assert.strictEqual(await llamar(), 200); // llega el webhook tarde
    assert.strictEqual(creadas.length, 2); assert.strictEqual(pagos.length, 2);
  });

  await caso('revisor: Flow aun sin resultado (estado 1) -> no toca nada', async () => {
    nuevo(); estadoFlow = { estado: 1, monto: '36295', comercioOrden: 'wc_abc' };
    const r = await reconciliarCobrosInicialesWeb();
    assert.strictEqual(r.pendientes, 1); assert.strictEqual(sw.estado, 'COBRANDO'); assert.strictEqual(alertas.length, 0);
  });

  await caso('revisor: un cobro reciente (< 5 min) se deja tranquilo', async () => {
    nuevo({ actualizadoEn: new Date() }); estadoFlow = { estado: 3, monto: '36295', comercioOrden: 'wc_abc' };
    const r = await reconciliarCobrosInicialesWeb();
    assert.strictEqual(r.revisadas, 0); assert.strictEqual(sw.estado, 'COBRANDO');
  });

  await caso('foto vieja: otro proceso ya guardo el plan -> NO se crea un segundo plan en Flow', async () => {
    nuevo({ flowSubscriptionId: 'sus_ya_creado' });          // lo que hay en la BD ahora
    const fotoVieja = { ...sw, flowSubscriptionId: null };    // lo que leyó este proceso antes
    const r = await procesarEstadoCobroInicial(fotoVieja, estadoFlow);
    assert.strictEqual(r.http, 200);
    assert.deepStrictEqual(creadas.map((c) => c.planId), ['plan-hosting']); // solo el hosting que faltaba
    assert.strictEqual(sw.flowSubscriptionId, 'sus_ya_creado');
  });

  await caso('rechazo de un intento viejo no anula un intento nuevo (otra orden)', async () => {
    nuevo({ ordenComercioCollectPendiente: 'wc_NUEVA' });
    const fotoVieja = { ...sw, ordenComercioCollectPendiente: 'wc_abc' };
    // el fake no filtra por orden, asi que se comprueba lo que la logica le pide a la BD
    let donde = null;
    const original = fakePrisma.suscripcionWeb.updateMany;
    fakePrisma.suscripcionWeb.updateMany = async (a) => { donde = a.where; return { count: 0 }; };
    await procesarEstadoCobroInicial(fotoVieja, { estado: 3, monto: '1', comercioOrden: 'wc_abc' });
    fakePrisma.suscripcionWeb.updateMany = original;
    assert.strictEqual(donde.ordenComercioCollectPendiente, 'wc_abc');
    assert.strictEqual(alertas.length, 0);
  });

  await caso('revisor: Flow no conoce la orden hace > 2 h -> una sola alerta "sin resolver", no spam', async () => {
    nuevo({ actualizadoEn: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const original = fakeFlow.consultarEstadoPorCommerceId;
    fakeFlow.consultarEstadoPorCommerceId = async () => { throw new Error('Flow error 105: orden no encontrada'); };
    await reconciliarCobrosInicialesWeb();
    await reconciliarCobrosInicialesWeb();
    fakeFlow.consultarEstadoPorCommerceId = original;
    assert.strictEqual(alertasSinResolver.length, 1);
    assert.strictEqual(sw.estado, 'COBRANDO');
  });

  console.log(`✅ ${n} casos OK`);
})().catch((e) => { console.error('❌', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exitCode = 1; });
