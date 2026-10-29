/**
 * src/lib/cobroInicialWeb.js
 *
 * Cobro inicial combinado de la suscripción web de Multidigital (plan del primer
 * período + hosting del primer año, ver src/routes/suscripcionWeb.js). Acá vive lo
 * que pasa cuando Flow informa el resultado de ese cobro, para que lo use igual:
 *   - POST /web/flow-webhook-collect (el aviso de Flow), y
 *   - el revisor periódico (src/jobs/reconciliarCobrosWeb.js), porque Flow NO avisa
 *     cuando el cobro es rechazado y la suscripción quedaría "cobrando" para siempre
 *     (visto en la prueba real del 2026-10-29: tarjeta inscrita, cobro rechazado).
 *
 * Es REANUDABLE: todo fallo ANTES de que Flow cree algo revierte a COBRANDO y pide
 * reintento (http 500); un reintento retoma donde quedó (omite el plan si
 * flowSubscriptionId ya existe). Un error ambiguo (timeout) en una llamada a Flow
 * nunca se reintenta solo: podría duplicar la suscripción, se deja un log
 * "REVISAR A MANO". Los pagos se anotan con una clave basada en la ORDEN (no en el
 * token del aviso), así el webhook y el revisor no los duplican.
 */

const prisma = require('./prisma');
const flowClient = require('../services/flowClient');
const { sumarMeses } = require('./linkSuscripcionWeb');
const { diaChileTexto } = require('./preciosWeb');
const { registrarPagoFlowEnClienteWeb } = require('../routes/clientesWeb');
const { enviarAlertaCobroRechazado, enviarAlertaCobroSinResolver } = require('../services/emailAlertaCobroWeb');

const DIA_MS = 24 * 60 * 60 * 1000;

function planIdFlow(plan) {
  return plan === 'ANUAL' ? process.env.FLOW_PLAN_ID_WEB_ANUAL : process.env.FLOW_PLAN_ID_WEB_MENSUAL;
}

// Medianoche UTC del día calendario de Chile en que cae `fecha`.
function diaChile(fecha) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  const v = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(v('year'), v('month') - 1, v('day'));
}

// Días de calendario en Chile entre hoy y `fecha` (no milisegundos: con ceil
// sobre ms, registrar la tarjeta en la mañana corría el cobro un día).
function diasHasta(fecha, ahora) {
  return Math.max(0, Math.round((diaChile(fecha) - diaChile(ahora)) / DIA_MS));
}

// Suma años de calendario (29-feb + 1 año -> 28-feb, no 1-mar).
function sumarAnios(fecha, anios) {
  const r = new Date(fecha);
  const dia = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCFullYear(r.getUTCFullYear() + anios);
  const ultimo = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(dia, ultimo));
  return r;
}

// requestFlow/requestFlowPost lanzan "Flow error <code>: ..." cuando Flow
// RESPONDE rechazando la operación (no se creó nada). Cualquier otro error
// (timeout, red, BD) deja la duda de si Flow alcanzó a crear la suscripción.
function esRechazoExplicitoDeFlow(error) {
  return /^Flow error /.test(error?.message || '');
}

/**
 * @param {Object} sw - SuscripcionWeb con ordenComercioCollectPendiente
 * @param {Object} estadoFlow - { estado, monto, comercioOrden, fechaPago } (consultarEstado / consultarEstadoPorCommerceId)
 * @returns {Promise<{http: number, texto: string}>} lo que debe responder el webhook
 */
async function procesarEstadoCobroInicial(sw, estadoFlow) {
  if (String(estadoFlow.estado) === '1') return { http: 200, texto: 'OK' }; // aún sin resultado
  const exitoso = String(estadoFlow.estado) === '2';

  if (!exitoso) {
    // Tarjeta rechazada u orden anulada: vuelve a ACEPTADA para que pueda reintentar desde el link,
    // y se avisa a Multidigital (el cliente ya vio "tarjeta inscrita": hay que contactarlo).
    const revertida = await prisma.suscripcionWeb.updateMany({
      where: { id: sw.id, estado: 'COBRANDO', ordenComercioCollectPendiente: sw.ordenComercioCollectPendiente },
      data: { estado: 'ACEPTADA', ordenComercioCollectPendiente: null },
    });
    if (revertida.count > 0) {
      console.warn(`[cobro-inicial-web] Cobro inicial NO pagado (estado ${estadoFlow.estado}) para ${sw.razonSocial || sw.nombreCliente} (${sw.id}).`);
      try {
        await enviarAlertaCobroRechazado({
          nombre: sw.razonSocial || sw.nombreCliente, emailCliente: sw.emailAceptacion || sw.emailCliente,
          plan: sw.plan, monto: (sw.montoPlanCollect || 0) + (sw.montoHostingCollect || 0), ref: sw.ref,
          tarjetaUltimos4: sw.tarjetaUltimos4,
        });
      } catch (errorAlerta) {
        console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: cobro rechazado y no se pudo enviar la alerta por correo:`, errorAlerta.message);
      }
    }
    return { http: 200, texto: 'OK' };
  }

  const montoEsperado = (sw.montoPlanCollect || 0) + (sw.montoHostingCollect || 0);
  if (Number(estadoFlow.monto) !== montoEsperado) {
    console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: Flow cobró $${estadoFlow.monto} y se esperaba $${montoEsperado}; no se activó nada.`);
    return { http: 200, texto: 'OK' };
  }

  const ahora = new Date();
  // Mediodía de Chile del día de pago: base estable de los aniversarios (el instante UTC
  // corría el cobro un día cuando se registraba de noche cerca de fin de mes).
  const inicioContrato = sw.fechaInicioContrato || new Date(`${diaChileTexto(ahora)}T12:00:00-03:00`);
  const tomado = await prisma.suscripcionWeb.updateMany({
    where: { id: sw.id, estado: 'COBRANDO', ordenComercioCollectPendiente: sw.ordenComercioCollectPendiente },
    data: { estado: 'ACTIVANDO', fechaInicioContrato: inicioContrato },
  });
  if (tomado.count === 0) {
    if (sw.estado !== 'ACTIVANDO' && sw.estado !== 'ACTIVA') {
      console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: Flow cobró $${estadoFlow.monto} pero la suscripción está en estado ${sw.estado}.`);
    }
    return { http: 200, texto: 'OK' }; // aviso repetido: ya se procesó
  }
  // Foto fresca: `sw` se leyó antes del claim y otro proceso (webhook / revisor) pudo haber guardado
  // flowSubscriptionId antes de revertir. Decidir con la foto vieja crearía un segundo plan en Flow.
  sw = await prisma.suscripcionWeb.findUnique({ where: { id: sw.id } });
  const revertir = () => prisma.suscripcionWeb.updateMany({ where: { id: sw.id, estado: 'ACTIVANDO' }, data: { estado: 'COBRANDO' } });
  const fechaPago = estadoFlow.fechaPago && !isNaN(new Date(estadoFlow.fechaPago)) ? new Date(estadoFlow.fechaPago) : ahora;

  // 1) El dinero ya entró: se anota primero (idempotente por orden). Si la BD falla acá,
  // en Flow todavía no se creó nada: se revierte y se reintenta.
  try {
    for (const [tipo, monto] of [['PLAN', sw.montoPlanCollect], ['HOSTING', sw.montoHostingCollect]]) {
      if (!monto) continue;
      const clave = `${sw.ordenComercioCollectPendiente}:${tipo}`;
      let pago;
      try {
        pago = await prisma.pagoWeb.create({
          data: { suscripcionWebId: sw.id, tipo, monto, estado: 'EXITOSO', flowToken: clave },
        });
      } catch (errorPago) {
        if (errorPago.code !== 'P2002') throw errorPago;
        pago = await prisma.pagoWeb.findUnique({ where: { flowToken: clave } }); // ya anotado: se reintenta solo la ficha
      }
      if (pago) await registrarPagoFlowEnClienteWeb({ suscripcionWebId: sw.id, pagoWebId: pago.id, tipo, monto, planSuscripcion: sw.plan, fecha: fechaPago });
    }
    await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { fechaUltimoPago: fechaPago } });
  } catch (errorBd) {
    await revertir();
    console.error(`[cobro-inicial-web] Falló la BD al anotar el pago de ${sw.id}; se reintenta:`, errorBd);
    return { http: 500, texto: 'Error anotando el pago' };
  }

  const planId = planIdFlow(sw.plan);
  const planIdHosting = process.env.FLOW_PLAN_ID_WEB_HOSTING;
  // Primer período ya pagado: el plan vuelve a cobrar en 1 mes/año y el hosting en el aniversario.
  const baseContrato = sw.fechaInicioContrato || inicioContrato;
  const trialPlan = Math.max(1, diasHasta(sw.plan === 'ANUAL' ? sumarAnios(baseContrato, 1) : sumarMeses(baseContrato, 1), ahora));
  const trialHosting = Math.max(1, diasHasta(sumarAnios(baseContrato, 1), ahora));

  // 2) Plan (se omite si un intento anterior ya lo creó).
  if (!sw.flowSubscriptionId) {
    let susPlan;
    try {
      susPlan = await flowClient.crearSuscripcionFlow({ planId, customerId: sw.flowCustomerId, trialPeriodDays: trialPlan });
    } catch (errorPlan) {
      if (esRechazoExplicitoDeFlow(errorPlan)) {
        await revertir(); // Flow no creó nada: se reintenta
        console.error(`[cobro-inicial-web] Flow rechazó crear el plan de ${sw.id}; se reintenta:`, errorPlan.message);
        return { http: 500, texto: 'Error creando la suscripcion' };
      }
      console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: cobro hecho pero no se sabe si Flow creó el plan:`, errorPlan);
      return { http: 200, texto: 'OK' };
    }
    try {
      await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { flowSubscriptionId: susPlan.subscriptionId } });
    } catch (errorGuardar) {
      // El plan YA existe en Flow: nunca revertir (un reintento crearía un segundo plan).
      console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: plan creado en Flow (${susPlan.subscriptionId}) pero no se pudo guardar:`, errorGuardar);
      return { http: 200, texto: 'OK' };
    }
  }

  // 3) Hosting (se omite si ya existe) y activación.
  let hostingId = sw.flowSubscriptionIdHosting;
  if (!hostingId) {
    try {
      hostingId = (await flowClient.crearSuscripcionFlow({ planId: planIdHosting, customerId: sw.flowCustomerId, trialPeriodDays: trialHosting })).subscriptionId;
    } catch (errorHosting) {
      if (esRechazoExplicitoDeFlow(errorHosting)) {
        await revertir(); // el plan ya quedó guardado: el reintento retoma desde el hosting
        console.error(`[cobro-inicial-web] Flow rechazó crear el hosting de ${sw.id}; se reintenta:`, errorHosting.message);
        return { http: 500, texto: 'Error creando la suscripcion de hosting' };
      }
      console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: plan creado pero no se sabe si Flow creó el hosting:`, errorHosting);
      return { http: 200, texto: 'OK' };
    }
  }
  try {
    await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { flowSubscriptionIdHosting: hostingId, estado: 'ACTIVA' } });
  } catch (errorFinal) {
    console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: hosting creado en Flow (${hostingId}) pero no se pudo guardar/activar:`, errorFinal);
    return { http: 200, texto: 'OK' };
  }

  console.log(`[cobro-inicial-web] Suscripción web ACTIVA: ${sw.id} (${sw.razonSocial}, ${sw.plan}); cobro inicial $${estadoFlow.monto}`);
  return { http: 200, texto: 'OK' };
}

// Cobros sin resolver por más de este tiempo (Flow no conoce la orden, o sigue "pendiente"):
// una sola alerta (en memoria: si el servidor se reinicia, vuelve a avisar una vez).
const MINUTOS_PARA_ALERTAR_SIN_RESOLVER = 120;
const yaAlertadasSinResolver = new Set();

async function alertarSiLlevaMuchoTiempo(sw, ahora, motivo) {
  const minutos = Math.round((ahora - sw.actualizadoEn) / 60000);
  if (minutos < MINUTOS_PARA_ALERTAR_SIN_RESOLVER || yaAlertadasSinResolver.has(sw.id)) return;
  yaAlertadasSinResolver.add(sw.id);
  console.error(`[cobro-inicial-web] REVISAR A MANO ${sw.id}: lleva ${minutos} min "cobrando" sin resolverse (${motivo}).`);
  try {
    await enviarAlertaCobroSinResolver({
      nombre: sw.razonSocial || sw.nombreCliente, emailCliente: sw.emailAceptacion || sw.emailCliente,
      monto: (sw.montoPlanCollect || 0) + (sw.montoHostingCollect || 0), ref: sw.ref, minutos, motivo,
    });
  } catch (errorAlerta) {
    console.error(`[cobro-inicial-web] No se pudo enviar la alerta de cobro sin resolver de ${sw.id}:`, errorAlerta.message);
  }
}

/**
 * Revisa las suscripciones que quedaron "cobrando" hace más de `minutos` y le pregunta a Flow
 * cómo terminó cada cobro (por la orden, que nosotros generamos). Pagado -> activa; rechazado o
 * anulado -> vuelve a ACEPTADA y avisa por correo. Sin respuesta de Flow, no toca nada.
 */
async function reconciliarCobrosInicialesWeb({ ahora = new Date(), minutos = 5, dryRun = false } = {}) {
  const candidatas = await prisma.suscripcionWeb.findMany({
    where: {
      estado: 'COBRANDO',
      ordenComercioCollectPendiente: { not: null },
      actualizadoEn: { lt: new Date(ahora.getTime() - minutos * 60 * 1000) },
    },
  });
  const resumen = { revisadas: candidatas.length, activadas: 0, rechazadas: 0, pendientes: 0, errores: 0 };
  for (const sw of candidatas) {
    try {
      const estadoFlow = await flowClient.consultarEstadoPorCommerceId(sw.ordenComercioCollectPendiente);
      const codigo = String(estadoFlow.estado);
      if (codigo === '1') {
        resumen.pendientes++;
        await alertarSiLlevaMuchoTiempo(sw, ahora, 'Flow dice que el cobro sigue pendiente');
        continue;
      }
      console.log(`[cobro-inicial-web] Reconciliación ${sw.id}: Flow dice estado ${codigo}${dryRun ? ' (dry-run)' : ''}`);
      if (dryRun) continue;
      const r = await procesarEstadoCobroInicial(sw, estadoFlow);
      if (r.http >= 500) resumen.errores++;
      else if (codigo === '2') resumen.activadas++;
      else resumen.rechazadas++;
    } catch (error) {
      resumen.errores++;
      console.error(`[cobro-inicial-web] Reconciliación ${sw.id} falló (se reintenta):`, error.message);
      await alertarSiLlevaMuchoTiempo(sw, ahora, `Flow respondió: ${error.message}`);
    }
  }
  if (candidatas.length) console.log('[cobro-inicial-web] Resumen reconciliación:', JSON.stringify(resumen));
  return resumen;
}

module.exports = {
  procesarEstadoCobroInicial, reconciliarCobrosInicialesWeb,
  planIdFlow, diasHasta, sumarAnios, esRechazoExplicitoDeFlow,
};
