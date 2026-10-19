#!/usr/bin/env node
/**
 * Activa el cobro anclado al día 1 para Ahorróptica (Suscripcion.cobroDia1,
 * decisión 2026-10-19): Diego paga el mes en curso al registrar la tarjeta y
 * de ahí en adelante se cobra cada día 1 (ver src/lib/cicloCobro.js).
 *
 * Solo prende el campo; no crea nada en Flow ni cobra. Por defecto DRY-RUN:
 * para aplicar de verdad, APLICAR=1. Requiere haber corrido antes
 * `npx prisma db push` (campo cobroDia1 nuevo).
 *
 * IMPORTANTE: solo tiene efecto si Diego AÚN NO registró su tarjeta
 * (tokenFlow vacío). Si ya tiene suscripción recurrente en Flow, el script
 * avisa y no cambia lo que Flow ya cobra.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/activar-cobro-dia1-ahoroptica.js
 *   APLICAR=1 node scripts/activar-cobro-dia1-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { diasHastaProximoDia1 } = require('../src/lib/cicloCobro');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } });
  if (!suscripcion) throw new Error('Ahorróptica no tiene Suscripcion');

  console.log(`Suscripcion: plan=${suscripcion.plan} estado=${suscripcion.estado} cobroDia1=${suscripcion.cobroDia1} montoMensualActual=${suscripcion.montoMensualActual} exentoDeHosting=${suscripcion.exentoDeHosting} promoHasta=${suscripcion.precioPromoHasta?.toISOString() || '-'} tokenFlow=${suscripcion.tokenFlow || '(sin suscripción en Flow)'}`);
  if (suscripcion.tokenFlow) {
    console.warn('⚠️  Ya tiene suscripción recurrente en Flow: este cambio NO mueve su fecha de cobro. Revisar antes de seguir.');
    return;
  }
  console.log(`Si registrara la tarjeta HOY: paga el mes en curso ahora y el primer cobro recurrente sería en ${diasHastaProximoDia1()} día(s), el día 1.`);

  if (!aplicar) {
    console.log('\nDRY-RUN: no se escribió nada. Para aplicar: APLICAR=1');
    return;
  }
  await prisma.suscripcion.update({ where: { empresaId: EMPRESA_ID }, data: { cobroDia1: true } });
  console.log('✅ cobroDia1 activado para Ahorróptica.');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
