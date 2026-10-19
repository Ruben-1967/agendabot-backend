#!/usr/bin/env node
/**
 * Activa el cobro anclado al día 7 de cada mes para Ahorróptica
 * (Suscripcion.cobroDiaMes, decisión 2026-10-19): Diego paga el mes en curso al
 * registrar la tarjeta y de ahí en adelante se cobra cada día 7 (ver
 * src/lib/cicloCobro.js). El 7 es el día en que se le envió el primer link de cobro.
 *
 * Solo prende el campo; no crea nada en Flow ni cobra ni manda mensajes. Por
 * defecto DRY-RUN: para aplicar de verdad, APLICAR=1. Requiere que la columna
 * cobroDiaMes ya exista (ver ALTER TABLE en el mensaje del commit / de la sesión).
 *
 * IMPORTANTE: solo tiene efecto si Diego AÚN NO registró su tarjeta
 * (tokenFlow vacío). Si ya tiene suscripción recurrente en Flow, el script
 * avisa y no cambia lo que Flow ya cobra.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/activar-cobro-dia-ahoroptica.js
 *   APLICAR=1 node scripts/activar-cobro-dia-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { diasHastaProximoCobro } = require('../src/lib/cicloCobro');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const DIA_COBRO = 7;

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } });
  if (!suscripcion) throw new Error('Ahorróptica no tiene Suscripcion');

  console.log(`Suscripcion: plan=${suscripcion.plan} estado=${suscripcion.estado} cobroDiaMes=${suscripcion.cobroDiaMes} montoMensualActual=${suscripcion.montoMensualActual} exentoDeHosting=${suscripcion.exentoDeHosting} promoHasta=${suscripcion.precioPromoHasta?.toISOString() || '-'} tokenFlow=${suscripcion.tokenFlow || '(sin suscripción en Flow)'}`);
  if (suscripcion.tokenFlow) {
    console.warn('⚠️  Ya tiene suscripción recurrente en Flow: este cambio NO mueve su fecha de cobro. Revisar antes de seguir.');
    return;
  }
  console.log(`Si registrara la tarjeta HOY: paga el mes en curso ahora y el primer cobro recurrente sería en ${diasHastaProximoCobro(new Date(), DIA_COBRO)} día(s), el día ${DIA_COBRO} del mes siguiente.`);

  if (!aplicar) {
    console.log('\nDRY-RUN: no se escribió nada. Para aplicar: APLICAR=1');
    return;
  }
  await prisma.suscripcion.update({ where: { empresaId: EMPRESA_ID }, data: { cobroDiaMes: DIA_COBRO } });
  console.log(`✅ cobroDiaMes=${DIA_COBRO} activado para Ahorróptica.`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
