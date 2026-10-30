/**
 * src/services/emailAvisoVisitaDemo.js
 *
 * Avisos internos a Multidigital sobre las visitas a las demos de muestras.multidigital.cl
 * (ver src/routes/visitasDemo.js y src/jobs/resumenVisitasDemo.js):
 *   - enviarAvisoVisitaDemo: la primera visita del día a una demo, con su historial.
 *   - enviarResumenDiarioVisitas: todas las demos abiertas en el día, a las 20:00 de Chile.
 * Van por correo y no por WhatsApp a propósito (decisión de Rubén, 30-oct): no depende de
 * plantillas de Meta ni arriesga el número. Sale por Resend con la misma cuenta que las
 * alertas de cobros web. Destino: VISITAS_DEMO_AVISO_EMAIL, por defecto contacto@multidigital.cl.
 */

const { Resend } = require('resend');

const REMITENTE = 'noreply@multidigital.cl';
const DESTINO_POR_DEFECTO = 'contacto@multidigital.cl';
const URL_MUESTRAS = 'https://muestras.multidigital.cl';

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaChile = (f) => new Date(f).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const veces = (n) => `${n} ${n === 1 ? 'vez' : 'veces'}`;
const linkDemo = (slug) => `<a href="${URL_MUESTRAS}/${escapar(slug)}.html">${escapar(slug)}.html</a>`;

async function enviar(subject, html) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const r = await resend.emails.send({ from: REMITENTE, to: process.env.VISITAS_DEMO_AVISO_EMAIL || DESTINO_POR_DEFECTO, subject, html });
  if (r.error) throw new Error(`Resend rechazó el aviso: ${JSON.stringify(r.error)}`);
}

/**
 * @param {Object} d
 * @param {string} d.slug
 * @param {string} d.dispositivo - de esta visita
 * @param {number} d.total - visitas históricas, incluida esta
 * @param {number} d.ultimos7 - visitas de los últimos 7 días, incluida esta
 * @param {number} d.celular
 * @param {number} d.computador
 * @param {Date} d.primera - fecha de la primera visita registrada
 * @param {Date|null} d.anterior - visita anterior a esta (null si es la primera)
 * @param {Array<{slug, visitas}>} d.otrasHoy - otras demos abiertas hoy
 */
function armarAviso(d) {
  const asunto = d.total === 1
    ? `Abrieron por primera vez la demo ${d.slug}.html`
    : `Abrieron la demo ${d.slug}.html (${d.total} visitas en total)`;
  const otras = d.otrasHoy.length
    ? `<p><b>Otras demos abiertas hoy:</b></p><ul>${d.otrasHoy.map((o) => `<li>${linkDemo(o.slug)}: ${veces(o.visitas)}</li>`).join('')}</ul>`
    : '';
  const html = `
    <h2>Alguien abrió la demo ${linkDemo(d.slug)}</h2>
    <p>Primera visita de hoy, desde un <b>${escapar(d.dispositivo)}</b>.</p>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td>Visitas en total</td><td><b>${d.total}</b></td></tr>
      <tr><td>Últimos 7 días</td><td>${d.ultimos7}</td></tr>
      <tr><td>Desde celular / computador</td><td>${d.celular} / ${d.computador}</td></tr>
      <tr><td>Primera visita</td><td>${fechaChile(d.primera)}</td></tr>
      <tr><td>Visita anterior</td><td>${d.anterior ? fechaChile(d.anterior) : 'ninguna, es la primera'}</td></tr>
    </table>
    ${otras}
    <p>Revisa su ficha antes del próximo seguimiento. Solo llega un aviso al día por demo; el resumen de todas las visitas del día llega a las 20:00.</p>`;
  return { asunto, html };
}

async function enviarAvisoVisitaDemo(datos) {
  const { asunto, html } = armarAviso(datos);
  await enviar(asunto, html);
}

/**
 * @param {Array<{slug, hoy, total, celular, computador}>} filas - demos abiertas hoy, más vistas primero
 */
function armarResumenDiario(filas) {
  const totalHoy = filas.reduce((s, f) => s + f.hoy, 0);
  const asunto = `Resumen de hoy: ${filas.length} ${filas.length === 1 ? 'demo abierta' : 'demos abiertas'}, ${totalHoy} ${totalHoy === 1 ? 'visita' : 'visitas'}`;
  const html = `
    <h2>Visitas a las demos de hoy</h2>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr style="text-align:left"><th>Demo</th><th>Hoy</th><th>Total</th><th>Celular / computador (hoy)</th></tr>
      ${filas.map((f) => `<tr><td>${linkDemo(f.slug)}</td><td><b>${f.hoy}</b></td><td>${f.total}</td><td>${f.celular} / ${f.computador}</td></tr>`).join('')}
    </table>`;
  return { asunto, html };
}

async function enviarResumenDiarioVisitas(filas) {
  const { asunto, html } = armarResumenDiario(filas);
  await enviar(asunto, html);
}

module.exports = { enviarAvisoVisitaDemo, enviarResumenDiarioVisitas, armarAviso, armarResumenDiario };
