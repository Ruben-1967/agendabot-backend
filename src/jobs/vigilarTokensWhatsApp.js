/**
 * src/jobs/vigilarTokensWhatsApp.js
 *
 * Cada 30 minutos revisa que el token de WhatsApp de cada negocio siga funcionando y no esté por
 * vencer; si no, avisa por correo. Ver src/lib/vigilarTokensWhatsApp.js. No manda nada a clientes
 * ni a pacientes: solo consulta a Meta y, si hay un problema, escribe a Multidigital.
 */

const cron = require('node-cron');
const { vigilarTokensWhatsApp } = require('../lib/vigilarTokensWhatsApp');

function iniciarJobVigilarTokensWhatsApp() {
  cron.schedule('*/30 * * * *', async () => {
    try {
      await vigilarTokensWhatsApp();
    } catch (err) {
      console.error('[tokens-whatsapp] Error en el job:', err);
    }
  }, { timezone: 'America/Santiago' });
}

module.exports = { iniciarJobVigilarTokensWhatsApp };
