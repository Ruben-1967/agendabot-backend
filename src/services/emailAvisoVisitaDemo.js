/**
 * src/services/emailAvisoVisitaDemo.js
 *
 * Aviso interno a Multidigital cuando alguien abre una demo de muestras.multidigital.cl por
 * primera vez en el día (ver src/routes/visitasDemo.js). Va por correo y no por WhatsApp a
 * propósito (decisión de Rubén, 30-oct): no depende de plantillas de Meta ni arriesga el número.
 * Sale por Resend con la misma cuenta que las alertas de cobros web.
 * Destino: VISITAS_DEMO_AVISO_EMAIL, por defecto contacto@multidigital.cl.
 */

const { Resend } = require('resend');

const REMITENTE = 'noreply@multidigital.cl';
const DESTINO_POR_DEFECTO = 'contacto@multidigital.cl';

async function enviarAvisoVisitaDemo({ slug, dispositivo }) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const link = `https://muestras.multidigital.cl/${slug}.html`;
  const r = await resend.emails.send({
    from: REMITENTE,
    to: process.env.VISITAS_DEMO_AVISO_EMAIL || DESTINO_POR_DEFECTO,
    subject: `Abrieron la demo ${slug}.html`,
    html: `
      <h2>Alguien abrió la demo ${slug}.html</h2>
      <p>Es la primera visita de hoy a esa demo, desde un <b>${dispositivo}</b>.</p>
      <p>Demo: <a href="${link}">${link}</a></p>
      <p>Revisa su ficha antes del próximo seguimiento. Solo llega un aviso al día por demo.</p>`,
  });
  if (r.error) throw new Error(`Resend rechazó el aviso: ${JSON.stringify(r.error)}`);
}

module.exports = { enviarAvisoVisitaDemo };
