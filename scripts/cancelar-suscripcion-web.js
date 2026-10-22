#!/usr/bin/env node
/**
 * Da de baja una suscripción web de Multidigital (cláusula 8 del contrato):
 * cancela en Flow el plan y el hosting, para que no haya cargos posteriores,
 * y la deja en CANCELADA. El sitio, hosting y correos se gestionan aparte.
 *
 * Uso:
 *   node scripts/cancelar-suscripcion-web.js --ref <ref del link>            (muestra qué haría)
 *   node scripts/cancelar-suscripcion-web.js --ref <ref del link> --confirmar
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { cancelarSuscripcionFlow } = require('../src/services/flowClient');

async function main() {
  const i = process.argv.indexOf('--ref');
  const ref = i >= 0 ? process.argv[i + 1] : null;
  const confirmar = process.argv.includes('--confirmar');
  if (!ref) throw new Error('Uso: --ref <ref> [--confirmar]');

  const sw = await prisma.suscripcionWeb.findUnique({ where: { ref } });
  if (!sw) throw new Error(`No existe una suscripción web con ref ${ref}`);
  console.log(`${sw.razonSocial || sw.nombreCliente} · ${sw.plan} · estado ${sw.estado}`);
  console.log(`Flow plan: ${sw.flowSubscriptionId || '-'} · Flow hosting: ${sw.flowSubscriptionIdHosting || '-'}`);
  if (sw.estado === 'CANCELADA') return console.log('Ya estaba cancelada.');
  if (!confirmar) return console.log('\nNo se hizo nada. Agrega --confirmar para cancelar.');

  // Se intentan las dos aunque una falle (ej. ya estaba cancelada en Flow de
  // una corrida anterior), y se informa cuál quedó pendiente.
  const fallidas = [];
  for (const id of [sw.flowSubscriptionId, sw.flowSubscriptionIdHosting].filter(Boolean)) {
    try {
      await cancelarSuscripcionFlow(id);
      console.log(`Cancelada en Flow: ${id}`);
    } catch (err) {
      fallidas.push(id);
      console.error(`No se pudo cancelar ${id}: ${err.message}`);
    }
  }
  if (fallidas.length > 0 && !process.argv.includes('--marcar-igual')) {
    console.error('\nEstado NO cambiado. Revisa esas suscripciones en el panel de Flow; si ya están canceladas allá, vuelve a correr con --marcar-igual.');
    process.exitCode = 1;
    return;
  }
  await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { estado: 'CANCELADA' } });
  console.log('Suscripción web CANCELADA.');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
