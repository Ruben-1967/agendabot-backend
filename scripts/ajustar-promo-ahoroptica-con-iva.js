#!/usr/bin/env node
/**
 * Los precios de Multidigital son "+ IVA" (decisión 2026-10-16). Flow cobra el monto del Plan tal cual, sin sumar IVA,
 * así que el cobro de la promo de Ahorróptica tiene que ser el neto + IVA: $9.900 + 19 % = $11.781.
 *
 * Qué hace (el monto de un plan recurrente de Flow se fija al crearlo, y editarlo no es seguro si ya tuvo
 * suscriptores, por eso se crea un Plan NUEVO en vez de editar el anterior):
 *   1. Crea en Flow el plan `agendabot-plan-a-promo-ahoroptica-iva` por el monto con IVA.
 *   2. Deja en la Suscripcion de Ahorróptica precioPromoMonto, precioPromoFlowPlanId y montoMensualActual con ese
 *      valor. El primer cobro y la suscripción recurrente salen de ahí (ver src/lib/precioSuscripcion.js).
 * El plan anterior ($9.900) queda en Flow sin uso.
 *
 * Por defecto es DRY-RUN. Para aplicar: APLICAR=1. Si el plan nuevo ya existe en Flow (corrida anterior que falló a
 * medias): PLAN_YA_EXISTE=1 salta solo la creación.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/ajustar-promo-ahoroptica-con-iva.js
 *   APLICAR=1 node scripts/ajustar-promo-ahoroptica-con-iva.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { crearPlanFlow } = require('../src/services/flowClient');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const NETO = 9900;
const IVA = 0.19;
const BRUTO = Math.round(NETO * (1 + IVA)); // 11.781
const FLOW_PLAN_ID_NUEVO = 'agendabot-plan-a-promo-ahoroptica-iva';

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const s = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } });
  if (!s) throw new Error('Ahorróptica no tiene Suscripcion');

  console.log(`Suscripcion actual: plan=${s.plan} estado=${s.estado} montoMensualActual=${s.montoMensualActual} precioPromoMonto=${s.precioPromoMonto} precioPromoFlowPlanId=${s.precioPromoFlowPlanId} tokenFlow=${s.tokenFlow || '(sin suscripción en Flow)'}`);
  if (s.tokenFlow) throw new Error('Ya tiene una suscripción recurrente en Flow: este script no la modifica. Revisar antes de seguir.');
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL en el entorno (urlCallback del plan)');

  console.log(`\nNeto $${NETO} + IVA ${IVA * 100}% = $${BRUTO} al mes.`);
  console.log(`Plan de Flow a crear: ${FLOW_PLAN_ID_NUEVO} -- $${BRUTO}/mes (mensual)`);
  console.log(`Se actualizará la suscripción: precioPromoMonto y montoMensualActual = ${BRUTO}, precioPromoFlowPlanId = ${FLOW_PLAN_ID_NUEVO}`);

  if (!aplicar) {
    console.log('\nDRY-RUN: no se creó ni se escribió nada. Para aplicar: APLICAR=1');
    return;
  }

  if (process.env.PLAN_YA_EXISTE === '1') {
    console.log('\nPLAN_YA_EXISTE=1: se omite la creación del plan en Flow.');
  } else {
    const plan = await crearPlanFlow({
      planId: FLOW_PLAN_ID_NUEVO,
      nombre: 'AgendaBot Plan A (promo Ahorróptica, IVA incluido)',
      montoClp: BRUTO,
      interval: 3, // mensual
      urlCallback: `${process.env.BACKEND_URL}/suscripcion/flow-webhook-plan`,
    });
    console.log('✅ Plan creado en Flow:', JSON.stringify(plan));
  }

  await prisma.suscripcion.update({
    where: { empresaId: EMPRESA_ID },
    data: { precioPromoMonto: BRUTO, precioPromoFlowPlanId: FLOW_PLAN_ID_NUEVO, montoMensualActual: BRUTO },
  });
  console.log('✅ Suscripcion de Ahorróptica actualizada. Ahora hay que volver a generar el link: node scripts/generar-link-suscripcion-ahoroptica.js');
}

main()
  .catch((error) => { console.error('❌ ERROR:', error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
