/**
 * src/lib/activarSuscripcionPorCobroFlow.js
 *
 * Lógica compartida para activar una Suscripcion una vez confirmado el
 * cobro combinado (plan + hosting) de Flow. Se usa desde dos lugares:
 * - POST /suscripcion/flow-webhook-collect (camino normal, Flow confirma solo)
 * - scripts/reconciliar-cobro-flow.js (camino manual, cuando el webhook
 *   nunca llegó — ej. Flow intentó notificar justo durante un redeploy)
 *
 * Crea las 2 suscripciones recurrentes en Flow (plan + hosting) con
 * trial_period_days para no duplicar el cobro del primer período, y deja
 * la Suscripcion en ACTIVA.
 */

const prisma = require('./prisma');
const flowClient = require('../services/flowClient');
const { PLANES: DETALLE_PLANES } = require('../services/contratoHtml');

const DIAS_TRIAL_PLAN = 30;
const DIAS_TRIAL_HOSTING = 365;
const DIAS_POR_MES_GRATIS = 30;

/**
 * @param {Object} params
 * @param {string} params.empresaId
 * @param {number} params.valorUf - CLP cobrados por el hosting en este primer pago
 * @param {string} params.token - flowOrderId de Flow para el cobro combinado (para los Pago)
 * @returns {{ ok: true, yaActiva?: true } | { ok: false, motivo: string }}
 */
async function activarSuscripcionPorCobroFlow({ empresaId, valorUf, token }) {
  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });
  if (!suscripcion) {
    return { ok: false, motivo: 'sin_suscripcion' };
  }

  if (suscripcion.estado === 'ACTIVA') {
    return { ok: true, yaActiva: true };
  }

  if (!suscripcion.flowCustomerId) {
    return { ok: false, motivo: 'sin_flowCustomerId' };
  }

  const letraPlan = suscripcion.plan.replace('PLAN_', '');
  const flowPlanId = process.env[`FLOW_PLAN_ID_${letraPlan}`];
  const flowPlanIdHosting = process.env.FLOW_PLAN_ID_HOSTING;
  if (!flowPlanId || !flowPlanIdHosting) {
    return { ok: false, motivo: 'sin_flow_plan_id' };
  }

  const detallePlan = DETALLE_PLANES[suscripcion.plan];
  const montoHostingCobrado = Number.isFinite(valorUf) ? valorUf : 0;

  // Términos especiales (ver Suscripcion.exentoDePlan/exentoDeHosting/mesesGratisPlan
  // en schema.prisma): si el plan está exento, nunca se crea su suscripción
  // recurrente de Flow — no hay nada que cobrarle jamás. Si solo tiene meses
  // de gracia, sí se crea, pero con un trial más largo — Flow mismo empieza
  // a cobrar solo cuando el trial termina, sin necesidad de un job que lo
  // "gradúe" a cobro normal.
  const planExento = suscripcion.exentoDePlan;
  const diasTrialPlan = suscripcion.mesesGratisPlan > 0
    ? suscripcion.mesesGratisPlan * DIAS_POR_MES_GRATIS
    : DIAS_TRIAL_PLAN;

  const subscripcionPlan = planExento ? null : await flowClient.crearSuscripcionFlow({
    planId: flowPlanId,
    customerId: suscripcion.flowCustomerId,
    trialPeriodDays: diasTrialPlan,
  });
  const subscripcionHosting = suscripcion.exentoDeHosting ? null : await flowClient.crearSuscripcionFlow({
    planId: flowPlanIdHosting,
    customerId: suscripcion.flowCustomerId,
    trialPeriodDays: DIAS_TRIAL_HOSTING,
  });

  const ahora = new Date();
  const fechaProximoCobro = new Date(ahora);
  fechaProximoCobro.setDate(fechaProximoCobro.getDate() + diasTrialPlan);
  const fechaProximoCobroHosting = new Date(ahora);
  fechaProximoCobroHosting.setDate(fechaProximoCobroHosting.getDate() + DIAS_TRIAL_HOSTING);

  await prisma.$transaction(async (tx) => {
    await tx.suscripcion.update({
      where: { empresaId },
      data: {
        estado: 'ACTIVA',
        fechaActivacion: suscripcion.fechaActivacion || ahora,
        tokenFlow: subscripcionPlan?.subscriptionId,
        flowSubscriptionIdHosting: subscripcionHosting?.subscriptionId,
        fechaUltimoPago: ahora,
        fechaProximoCobro,
        fechaProximoCobroHosting,
        intentosFallidosConsecutivos: 0,
        ordenComercioCollectPendiente: null,
        valorUfCollectPendiente: null,
      },
    });

    // Sin Pago si no hubo cobro real este ciclo (exento, o en período de
    // gracia) — el ledger de Pago solo registra plata que efectivamente
    // se cobró.
    if (!planExento && suscripcion.mesesGratisPlan === 0) {
      await tx.pago.create({
        data: {
          suscripcionId: suscripcion.id,
          tipo: 'PRIMER_PAGO',
          monto: detallePlan.montoMensual,
          estado: 'EXITOSO',
          flowOrderId: token,
        },
      });
    }

    if (!suscripcion.exentoDeHosting) {
      await tx.pago.create({
        data: {
          suscripcionId: suscripcion.id,
          tipo: 'HOSTING',
          monto: montoHostingCobrado,
          valorUfDelDia: montoHostingCobrado,
          estado: 'EXITOSO',
          flowOrderId: token,
        },
      });
    }

    // Si venía de avisos/bloqueo por prueba vencida (ver
    // bloquearEmpresasVencidas.js), pagar la limpia por completo.
    await tx.empresa.update({
      where: { id: empresaId },
      data: {
        bloqueadaPorPruebaVencida: false,
        avisosPruebaVencidaEnviados: 0,
        fechaUltimoAvisoPrueba: null,
        fechaBloqueoPrueba: null,
      },
    });
  });

  return { ok: true };
}

module.exports = { activarSuscripcionPorCobroFlow };
