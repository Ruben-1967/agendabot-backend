#!/usr/bin/env node
/**
 * Reconcilia manualmente un cobro combinado de Flow (/customer/collect) cuyo
 * webhook de confirmación nunca llegó — por ejemplo porque el servidor
 * estaba redesplegando justo en ese momento. Consulta el estado real del
 * cobro directamente en Flow (usando el commerceOrder que quedó guardado en
 * la propia Suscripcion al dispararlo) y, si Flow confirma que se pagó,
 * activa la Suscripcion exactamente igual que lo haría el webhook normal.
 *
 * Es seguro correrlo aunque la Suscripcion ya esté ACTIVA — no hace nada en
 * ese caso.
 *
 * Uso (Render Shell):
 *   node scripts/reconciliar-cobro-flow.js <empresaId>
 *
 * Si /payment/getStatusByCommerceId responde "Transaction not found" pese a
 * que el cobro SÍ aparece "Pagada" en el dashboard de Flow (Suscripciones >
 * Clientes > [cliente] > Cobros realizados) — visto en sandbox con cobros
 * originados en /customer/collect, esa API de consulta no los encuentra —
 * usar --forzar para activar sin la consulta, solo después de confirmar a
 * mano en el dashboard que de verdad dice "Pagada":
 *   node scripts/reconciliar-cobro-flow.js <empresaId> --forzar [nOrdenFlow]
 */

require('dotenv').config();
const flowClient = require('../src/services/flowClient');
const { activarSuscripcionPorCobroFlow } = require('../src/lib/activarSuscripcionPorCobroFlow');
const prisma = require('../src/lib/prisma');

const empresaId = process.argv[2];
const forzar = process.argv.includes('--forzar');
const nOrdenFlow = process.argv[4];

if (!empresaId) {
  console.error('Uso: node scripts/reconciliar-cobro-flow.js <empresaId> [--forzar [nOrdenFlow]]');
  process.exit(1);
}

async function main() {
  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });
  if (!suscripcion) {
    console.error(`\n❌ No hay Suscripcion para la empresa ${empresaId}.`);
    process.exit(1);
  }

  if (suscripcion.estado === 'ACTIVA') {
    console.log('\n✅ La Suscripcion ya estaba ACTIVA — no hacía falta reconciliar.');
    return;
  }

  const commerceOrder = suscripcion.ordenComercioCollectPendiente;
  if (!commerceOrder) {
    console.error('\n❌ Esta Suscripcion no tiene un cobro combinado pendiente registrado (nunca se disparó, o ya se limpió).');
    process.exit(1);
  }

  let token = commerceOrder;

  if (forzar) {
    console.log('⚠️  Modo --forzar: activando SIN consultar a Flow — asumo que ya confirmaste "Pagada" a mano en el dashboard.\n');
    if (nOrdenFlow) token = nOrdenFlow;
  } else {
    console.log(`Consultando en Flow el estado de "${commerceOrder}"...\n`);
    const estadoFlow = await flowClient.consultarEstadoPorCommerceId(commerceOrder);
    console.log('Respuesta de Flow:', JSON.stringify(estadoFlow, null, 2));

    // estado: 1=Iniciado, 2=Pagado, 3=Rechazado, 4=Anulado
    if (String(estadoFlow.estado) !== '2') {
      console.log(`\n❌ El cobro NO está pagado (estado ${estadoFlow.estado}) — no hay nada que reconciliar.`);
      return;
    }
    token = estadoFlow.token;
  }

  console.log(`\n✅ Activando Suscripcion de empresa ${empresaId}...`);

  const resultado = await activarSuscripcionPorCobroFlow({
    empresaId,
    valorUf: suscripcion.valorUfCollectPendiente,
    token,
  });

  if (!resultado.ok) {
    console.error(`\n❌ No se pudo activar: ${resultado.motivo}`);
    process.exit(1);
  }

  console.log('\n✅ Suscripcion activada correctamente.');
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
