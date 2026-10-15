#!/usr/bin/env node
/**
 * Al cambiar a la cuenta de Flow de Multidigital, los identificadores guardados de la cuenta ANTERIOR (cliente,
 * suscripción del plan, suscripción de hosting) dejan de existir en la cuenta nueva: Flow respondería "no encontrado" al
 * intentar usarlos. Este script los borra de la tabla Suscripcion para que cada cliente vuelva a registrar su tarjeta
 * y se cree su cliente/suscripción en la cuenta nueva.
 *
 * - Por defecto es DRY-RUN: solo muestra qué haría. Para aplicar: APLICAR=1.
 * - Si hay suscripciones ACTIVAS con suscripción recurrente en Flow (clientes que ya pagan), NO aplica aunque pongas
 *   APLICAR=1: esos clientes dejarían de cobrarse. Hay que decidirlo caso a caso; FORZAR_ACTIVAS=1 lo permite.
 * - No toca precioPromo* (la promo se vuelve a configurar con scripts/configurar-promo-ahoroptica-flow.js, que crea el
 *   plan promocional en la cuenta nueva) ni el historial de pagos.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/olvidar-datos-flow-cuenta-anterior.js
 *   APLICAR=1 node scripts/olvidar-datos-flow-cuenta-anterior.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const corto = (v) => (v ? `${String(v).slice(0, 6)}…` : '-');

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const suscripciones = await prisma.suscripcion.findMany({
    where: { OR: [{ flowCustomerId: { not: null } }, { tokenFlow: { not: null } }, { flowSubscriptionIdHosting: { not: null } }] },
    select: { id: true, estado: true, plan: true, flowCustomerId: true, tokenFlow: true, flowSubscriptionIdHosting: true, empresa: { select: { nombre: true } } },
  });

  console.log(`Suscripciones con datos de Flow de la cuenta anterior: ${suscripciones.length}\n`);
  for (const s of suscripciones) {
    console.log(`- ${s.empresa?.nombre || '(sin empresa)'} | ${s.plan} | ${s.estado} | cliente ${corto(s.flowCustomerId)} | suscripción plan ${corto(s.tokenFlow)} | hosting ${corto(s.flowSubscriptionIdHosting)}`);
  }

  const conCobroRecurrente = suscripciones.filter((s) => s.estado === 'ACTIVA' && (s.tokenFlow || s.flowSubscriptionIdHosting));
  if (conCobroRecurrente.length > 0) {
    console.warn(`\n⚠️  ${conCobroRecurrente.length} suscripción(es) ACTIVA(S) tienen cobro recurrente en la cuenta anterior de Flow: ` +
      conCobroRecurrente.map((s) => s.empresa?.nombre).join(', '));
    console.warn('   Borrarles los datos los deja sin cobro automático hasta que vuelvan a registrar su tarjeta.');
  }

  if (!aplicar) {
    console.log('\nDRY-RUN: no se cambió nada. Para aplicar: APLICAR=1 node scripts/olvidar-datos-flow-cuenta-anterior.js');
    return;
  }
  if (conCobroRecurrente.length > 0 && process.env.FORZAR_ACTIVAS !== '1') {
    console.error('\nNO se aplicó: hay suscripciones activas con cobro recurrente (ver arriba). Si de verdad quieres seguir: FORZAR_ACTIVAS=1.');
    process.exit(1);
  }

  const r = await prisma.suscripcion.updateMany({
    where: { id: { in: suscripciones.map((s) => s.id) } },
    data: { flowCustomerId: null, tokenFlow: null, flowSubscriptionIdHosting: null },
  });
  console.log(`\n✅ Listo: ${r.count} suscripción(es) sin datos de la cuenta anterior de Flow.`);
}

main()
  .catch((error) => { console.error('❌ ERROR:', error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
