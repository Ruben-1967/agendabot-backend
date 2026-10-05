#!/usr/bin/env node
/**
 * Configura el precio promocional de Ahorróptica: $9.900/mes hasta el
 * 31-dic-2026 (pactado con el cliente, 2026-10-05). El monto de una
 * suscripción recurrente lo fija el Plan de Flow, así que esto:
 *   1. Crea en Flow un Plan propio "agendabot-plan-a-promo-ahoroptica" de
 *      $9.900/mes (no toca los planes A/B/C/D de los demás clientes).
 *   2. Deja en la Suscripcion de Ahorróptica los campos precioPromo* para que
 *      elegir-plan / el primer cobro / la suscripción recurrente usen ese
 *      plan mientras la promo esté vigente (ver src/lib/precioSuscripcion.js).
 *
 * Por defecto es DRY-RUN (no crea nada en Flow ni escribe en la base).
 * Para aplicar de verdad: APLICAR=1. Si el plan ya existe en Flow (corrida
 * anterior que falló a medias): PLAN_YA_EXISTE=1 salta solo la creación.
 *
 * Requiere haber corrido `npx prisma db push` (campos precioPromo* nuevos).
 *
 * Uso (Shell de Render, producción):
 *   node scripts/configurar-promo-ahoroptica-flow.js
 *   APLICAR=1 node scripts/configurar-promo-ahoroptica-flow.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { crearPlanFlow } = require('../src/services/flowClient');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const PLAN_ENUM = 'PLAN_A';
const FLOW_PLAN_ID_PROMO = 'agendabot-plan-a-promo-ahoroptica';
const MONTO_PROMO = 9900;
// 31-dic-2026 23:59:59 hora de Chile (verano, UTC-3).
const PROMO_HASTA = new Date('2027-01-01T02:59:59Z');

async function main() {
  const aplicar = process.env.APLICAR === '1';

  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } });
  if (!suscripcion) throw new Error('Ahorróptica no tiene Suscripcion');

  console.log(`Suscripcion actual: plan=${suscripcion.plan} estado=${suscripcion.estado} montoMensualActual=${suscripcion.montoMensualActual} exentoDeHosting=${suscripcion.exentoDeHosting} tokenFlow=${suscripcion.tokenFlow || '(sin suscripción en Flow)'}`);
  if (suscripcion.tokenFlow) {
    console.warn('⚠️  Ya tiene una suscripción recurrente en Flow (tokenFlow) -- configurar la promo ahora NO cambia lo que Flow ya cobra. Revisar antes de seguir.');
  }
  if (!suscripcion.exentoDeHosting) {
    console.warn('⚠️  exentoDeHosting=false: el primer cobro incluiría el hosting anual (1 UF), no solo $9.900.');
  }
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL en el entorno (urlCallback del plan)');

  console.log(`\nPlan de Flow a crear: ${FLOW_PLAN_ID_PROMO} -- $${MONTO_PROMO}/mes (interval mensual)`);
  console.log(`Promo vigente hasta: ${PROMO_HASTA.toISOString()} (31-dic-2026 23:59:59 Chile)`);

  if (!aplicar) {
    console.log('\nDRY-RUN: no se creó ni se escribió nada. Para aplicar: APLICAR=1');
    return;
  }

  if (process.env.PLAN_YA_EXISTE === '1') {
    console.log('PLAN_YA_EXISTE=1: se salta la creación del plan en Flow.');
  } else {
    const plan = await crearPlanFlow({
      planId: FLOW_PLAN_ID_PROMO,
      nombre: 'AgendaBot Plan A (promo Ahorróptica)',
      montoClp: MONTO_PROMO,
      interval: 3, // mensual
      urlCallback: `${process.env.BACKEND_URL}/suscripcion/flow-webhook-plan`,
    });
    console.log('✅ Plan creado en Flow:', JSON.stringify(plan));
  }

  await prisma.suscripcion.update({
    where: { empresaId: EMPRESA_ID },
    data: {
      plan: PLAN_ENUM,
      montoMensualActual: MONTO_PROMO,
      precioPromoMonto: MONTO_PROMO,
      precioPromoFlowPlanId: FLOW_PLAN_ID_PROMO,
      precioPromoPlan: PLAN_ENUM,
      precioPromoHasta: PROMO_HASTA,
    },
  });
  console.log('✅ Suscripcion de Ahorróptica actualizada con el precio promocional.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
