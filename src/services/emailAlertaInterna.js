/**
 * src/services/emailAlertaInterna.js
 *
 * Alertas internas para Multidigital (no van a clientes). Salen por Resend, con la misma cuenta
 * que los demás correos de Multidigital, y llegan a ALERTA_INTERNA_EMAIL (por defecto
 * contacto@multidigital.cl). Se eligió correo y no WhatsApp a propósito: si lo que falló es
 * WhatsApp, un aviso por WhatsApp no llegaría.
 */

const { Resend } = require('resend');

const REMITENTE = 'noreply@multidigital.cl';
const DESTINO_POR_DEFECTO = 'contacto@multidigital.cl';

async function enviarAlertaInterna({ asunto, html }) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const r = await resend.emails.send({
    from: REMITENTE,
    to: process.env.ALERTA_INTERNA_EMAIL || DESTINO_POR_DEFECTO,
    subject: asunto,
    html,
  });
  if (r.error) throw new Error(`Resend rechazó la alerta: ${JSON.stringify(r.error)}`);
}

module.exports = { enviarAlertaInterna };
