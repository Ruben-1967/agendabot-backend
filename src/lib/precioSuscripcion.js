/**
 * Precio mensual y Plan de Flow que corresponden a una Suscripcion AHORA.
 *
 * Normalmente: el monto de DETALLE_PLANES y el Plan de Flow del entorno
 * (FLOW_PLAN_ID_A/B/C/D). Si la suscripción tiene un precio promocional
 * vigente para ESE plan (ver precioPromo* en schema.prisma), se usa el
 * monto y el Plan de Flow propios de la promo -- el monto de una
 * suscripción recurrente lo fija el Plan de Flow, no se puede variar por
 * cliente de otra forma. Fuente única para elegir-plan, el primer cobro y
 * la creación de la suscripción recurrente (antes los 3 leían
 * DETALLE_PLANES directo).
 *
 * @param {Object} suscripcion - necesita plan + precioPromo*
 * @param {Object} detallePlan - DETALLE_PLANES[plan]
 * @param {Date} [ahora]
 * @returns {{ monto: number, flowPlanId: string|undefined, esPromo: boolean }}
 */
const { conIva } = require('./iva');

function obtenerPrecioVigente(suscripcion, detallePlan, ahora = new Date()) {
  const promoVigente = Boolean(
    suscripcion.precioPromoMonto
    && suscripcion.precioPromoFlowPlanId
    && suscripcion.precioPromoPlan === suscripcion.plan
    && suscripcion.precioPromoHasta
    && ahora <= suscripcion.precioPromoHasta
  );

  if (promoVigente) {
    return { monto: suscripcion.precioPromoMonto, flowPlanId: suscripcion.precioPromoFlowPlanId, esPromo: true };
  }

  const letraPlan = suscripcion.plan.replace('PLAN_', '');
  // detallePlan.montoMensual es NETO (ver src/lib/iva.js): lo que se cobra lleva IVA.
  // El precio promocional, en cambio, ya se guarda con IVA incluido (ej. $11.781).
  return { monto: conIva(detallePlan.montoMensual), flowPlanId: process.env[`FLOW_PLAN_ID_${letraPlan}`], esPromo: false };
}

module.exports = { obtenerPrecioVigente };
