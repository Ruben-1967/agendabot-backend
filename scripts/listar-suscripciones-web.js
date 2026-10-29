#!/usr/bin/env node
/**
 * Lista las suscripciones web de Multidigital (sitio web + correos) con su
 * estado, link y últimos pagos. Marca con ⚠️ las que necesitan revisión a mano:
 * en ACTIVANDO hace más de 15 minutos (se cortó la activación: revisar en el
 * panel de Flow si el cliente quedó suscrito al plan y/o al hosting) o con el
 * último cobro FALLIDO. Solo lee, no cambia nada.
 *
 * Uso: node scripts/listar-suscripciones-web.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const fmt = (f) => (f ? f.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : '-');

async function main() {
  const filas = await prisma.suscripcionWeb.findMany({
    orderBy: { creadoEn: 'desc' },
    include: { pagos: { orderBy: { fecha: 'desc' }, take: 3 } },
  });
  if (filas.length === 0) return console.log('No hay suscripciones web.');

  for (const sw of filas) {
    const atascada = (sw.estado === 'ACTIVANDO' || sw.estado === 'COBRANDO') && Date.now() - sw.actualizadoEn.getTime() > 15 * 60 * 1000;
    const ultimoFallido = sw.pagos[0]?.estado === 'FALLIDO';
    console.log(`${atascada || ultimoFallido ? '⚠️ ' : ''}${sw.razonSocial || sw.nombreCliente} · ${sw.plan} $${sw.montoConIva.toLocaleString('es-CL')} · ${sw.estado}`);
    console.log(`   link: ${process.env.BACKEND_URL || ''}/web/suscribir/${sw.ref}`);
    console.log(`   aceptó: ${fmt(sw.fechaAceptacion)} (${sw.versionContrato || '-'}) · 1er cobro: ${sw.fechaPrimerCobro ? fmt(sw.fechaPrimerCobro) : 'al registrar'} · inicio: ${fmt(sw.fechaInicioContrato)}`);
    console.log(`   Flow plan: ${sw.flowSubscriptionId || '-'} · hosting: ${sw.flowSubscriptionIdHosting || '-'} · tarjeta: ${sw.tarjetaUltimos4 || '-'}`);
    for (const p of sw.pagos) console.log(`   pago ${fmt(p.fecha)} ${p.tipo} $${p.monto.toLocaleString('es-CL')} ${p.estado}`);
    if (sw.estado === 'COBRANDO') console.log(`   cobro inicial: plan $${(sw.montoPlanCollect || 0).toLocaleString('es-CL')} + hosting $${(sw.montoHostingCollect || 0).toLocaleString('es-CL')} · orden ${sw.ordenComercioCollectPendiente || '-'}`);
    if (atascada) console.log(`   -> ${sw.estado} hace más de 15 min: revisar en Flow (si el cobro está pagado, completar a mano; si no, el cliente debe reintentar).`);
  }
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
