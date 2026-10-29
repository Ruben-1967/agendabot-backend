/**
 * src/jobs/reconciliarCobrosWeb.js
 *
 * Cada 10 minutos revisa las suscripciones web que quedaron "cobrando" (cobro inicial
 * combinado en Flow) y le pregunta a Flow cómo terminaron. Flow no avisa los cobros
 * rechazados, así que sin esto el cliente quedaría en espera para siempre sin que nadie lo
 * sepa. Ver src/lib/cobroInicialWeb.js. Solo corre donde Flow está configurado (FLOW_API_KEY),
 * es decir, no en staging.
 */

const cron = require('node-cron');
const { reconciliarCobrosInicialesWeb } = require('../lib/cobroInicialWeb');

function iniciarJobReconciliarCobrosWeb() {
  cron.schedule('*/10 * * * *', async () => {
    if (!process.env.FLOW_API_KEY) return;
    try {
      await reconciliarCobrosInicialesWeb();
    } catch (err) {
      console.error('[cobro-inicial-web] Error en el job de reconciliación:', err);
    }
  }, { timezone: 'America/Santiago' });
}

module.exports = { iniciarJobReconciliarCobrosWeb };
