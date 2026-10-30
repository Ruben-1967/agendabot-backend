// src/jobs/resumenVisitasDemo.js
//
// Resumen diario de las visitas a las demos de muestras.multidigital.cl (2026-10-30, pedido
// de Rubén): a las 20:00 de Chile, un correo con todas las demos abiertas en el día, cuántas
// veces hoy y en total. Complementa el aviso de la primera visita del día (ver
// src/routes/visitasDemo.js), que no avisa las visitas siguientes. Si nadie abrió una demo,
// no se envía nada.
//
// Mismo patrón que pausaCoexistence.js: node-cron dentro del proceso web.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { enviarResumenDiarioVisitas } = require('../services/emailAvisoVisitaDemo');
const { fechaISOEnChile, horaChileAFechaUTC } = require('../lib/horaChile');

async function enviarResumenVisitasDeHoy(ahora = new Date()) {
  const inicioDelDia = horaChileAFechaUTC(fechaISOEnChile(ahora), '00:00');
  const deHoy = await prisma.visitaDemo.findMany({ where: { creadoEn: { gte: inicioDelDia } }, select: { slug: true, dispositivo: true } });
  if (deHoy.length === 0) return;

  const porSlug = new Map();
  for (const v of deHoy) {
    const f = porSlug.get(v.slug) || { slug: v.slug, hoy: 0, celular: 0, computador: 0 };
    f.hoy++;
    if (v.dispositivo === 'celular') f.celular++; else f.computador++;
    porSlug.set(v.slug, f);
  }
  const totales = await prisma.visitaDemo.groupBy({ by: ['slug'], where: { slug: { in: [...porSlug.keys()] } }, _count: { _all: true } });
  for (const t of totales) porSlug.get(t.slug).total = t._count._all;

  const filas = [...porSlug.values()].sort((a, b) => b.hoy - a.hoy || b.total - a.total);
  await enviarResumenDiarioVisitas(filas);
  console.log(`[VISITAS-DEMO] Resumen diario enviado: ${filas.length} demos, ${deHoy.length} visitas.`);
}

cron.schedule('0 20 * * *', () => {
  enviarResumenVisitasDeHoy().catch((error) => {
    console.error('[VISITAS-DEMO] Error enviando el resumen diario:', error.message);
  });
}, { timezone: 'America/Santiago' });

module.exports = { enviarResumenVisitasDeHoy };
