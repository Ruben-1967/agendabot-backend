#!/usr/bin/env node
/**
 * Pasa al plan normal a las suscripciones cuyo precio promocional ya venció
 * (precioPromoHasta < ahora) y que todavía cobran por el Plan de Flow de la
 * promo. Hoy aplica a Ahorróptica ($9.900 hasta el 31-dic-2026 -> Plan A
 * normal).
 *
 * Qué hace por cada una: cancela su suscripción recurrente en Flow, crea una
 * nueva sobre el plan normal (FLOW_PLAN_ID_<letra>) con trial_period_days
 * hasta la fecha del próximo cobro (para no cambiar el día de cobro), y deja
 * en la base el monto normal y los campos precioPromo* en null.
 *
 * CUÁNDO CORRERLO: después del 31-dic-2026 y ANTES del primer cobro de enero
 * (con la fecha de activación esperada, ese cobro cae ~5-6 de enero). Si
 * nadie lo corre, el cliente sigue pagando el precio promo -- falla hacia
 * cobrar de menos, nunca de más.
 *
 * Por defecto DRY-RUN (solo muestra). Para aplicar: APLICAR=1
 *
 * Uso (Shell de Render, producción):
 *   node scripts/migrar-promo-vencida-flow.js
 *   APLICAR=1 node scripts/migrar-promo-vencida-flow.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const flowClient = require('../src/services/flowClient');
const { PLANES: DETALLE_PLANES } = require('../src/services/contratoHtml');

const MS_DIA = 24 * 60 * 60 * 1000;

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const ahora = new Date();

  const candidatas = await prisma.suscripcion.findMany({
    where: { precioPromoFlowPlanId: { not: null }, precioPromoHasta: { lt: ahora } },
  });
  console.log(`${candidatas.length} suscripción(es) con promo vencida.\n`);

  for (const s of candidatas) {
    const letra = s.plan.replace('PLAN_', '');
    const flowPlanIdNormal = process.env[`FLOW_PLAN_ID_${letra}`];
    const montoNormal = DETALLE_PLANES[s.plan]?.montoMensual;
    const diasTrial = Math.max(1, Math.ceil((new Date(s.fechaProximoCobro) - ahora) / MS_DIA));

    console.log(`- empresa ${s.empresaId}: ${s.plan}, promo $${s.precioPromoMonto} venció ${s.precioPromoHasta.toISOString()}`);
    console.log(`    tokenFlow=${s.tokenFlow || '(ninguno)'} | próximo cobro ${new Date(s.fechaProximoCobro).toISOString()} -> trial ${diasTrial} día(s)`);
    console.log(`    nuevo: plan Flow ${flowPlanIdNormal || '(FALTA FLOW_PLAN_ID_' + letra + ')'} a $${montoNormal}/mes`);

    if (!flowPlanIdNormal || !montoNormal || !s.flowCustomerId) {
      console.warn('    ⚠️  Faltan datos (plan de Flow normal, monto o flowCustomerId) -- se omite.\n');
      continue;
    }
    if (!aplicar) { console.log('    (dry-run)\n'); continue; }

    if (s.tokenFlow) {
      await flowClient.cancelarSuscripcionFlow(s.tokenFlow);
    }
    const nueva = await flowClient.crearSuscripcionFlow({
      planId: flowPlanIdNormal,
      customerId: s.flowCustomerId,
      trialPeriodDays: diasTrial,
    });
    await prisma.suscripcion.update({
      where: { id: s.id },
      data: {
        tokenFlow: nueva.subscriptionId,
        montoMensualActual: montoNormal,
        fechaCambioPrecio: ahora,
        precioPromoMonto: null,
        precioPromoFlowPlanId: null,
        precioPromoPlan: null,
        precioPromoHasta: null,
      },
    });
    console.log(`    ✅ Migrada. Nueva suscripción Flow: ${nueva.subscriptionId}\n`);
  }

  if (!aplicar && candidatas.length > 0) console.log('DRY-RUN: no se cambió nada. Para aplicar: APLICAR=1');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
