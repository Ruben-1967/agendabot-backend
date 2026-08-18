#!/usr/bin/env node
/**
 * Reconcilia manualmente un cobro combinado de Flow (/customer/collect) cuyo
 * webhook de confirmación nunca llegó — por ejemplo porque el servidor
 * estaba redesplegando justo en ese momento. Consulta el estado real del
 * cobro directamente en Flow por commerceOrder (no hace falta tener
 * guardado el token en ningún lado) y, si Flow confirma que se pagó, activa
 * la Suscripcion exactamente igual que lo haría el webhook normal.
 *
 * Es seguro correrlo aunque la Suscripcion ya esté ACTIVA — no hace nada en
 * ese caso.
 *
 * Uso (Render Shell):
 *   node scripts/reconciliar-cobro-flow.js <commerceOrder>
 *
 * El commerceOrder queda en los logs cuando se disparó el cobro:
 * "[flow-callback-tarjeta] Cobro combinado disparado para empresa X (orden <commerceOrder>)"
 */

require('dotenv').config();
const flowClient = require('../src/services/flowClient');
const { activarSuscripcionPorCobroFlow } = require('../src/lib/activarSuscripcionPorCobroFlow');
const prisma = require('../src/lib/prisma');

const commerceOrder = process.argv[2];
if (!commerceOrder) {
  console.error('Uso: node scripts/reconciliar-cobro-flow.js <commerceOrder>');
  process.exit(1);
}

async function main() {
  console.log(`Consultando en Flow el estado de "${commerceOrder}"...\n`);
  const estadoFlow = await flowClient.consultarEstadoPorCommerceId(commerceOrder);

  console.log('Respuesta de Flow:', JSON.stringify(estadoFlow, null, 2));

  // estado: 1=Iniciado, 2=Pagado, 3=Rechazado, 4=Anulado
  if (String(estadoFlow.estado) !== '2') {
    console.log(`\n❌ El cobro NO está pagado (estado ${estadoFlow.estado}) — no hay nada que reconciliar.`);
    return;
  }

  const partes = commerceOrder.split('_');
  if (partes[0] !== 'flow-combinado' || !partes[1]) {
    console.error('\n❌ El commerceOrder no tiene el formato esperado (flow-combinado_<empresaId>_<valorUf>_<timestamp>).');
    process.exit(1);
  }
  const empresaId = partes[1];
  const valorUf = Number(partes[2]);

  console.log(`\n✅ Cobro confirmado como pagado. Activando Suscripcion de empresa ${empresaId}...`);

  const resultado = await activarSuscripcionPorCobroFlow({ empresaId, valorUf, token: estadoFlow.token });

  if (!resultado.ok) {
    console.error(`\n❌ No se pudo activar: ${resultado.motivo}`);
    process.exit(1);
  }

  console.log(resultado.yaActiva
    ? '\n✅ La Suscripcion ya estaba ACTIVA — no hacía falta reconciliar.'
    : '\n✅ Suscripcion activada correctamente.');
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
