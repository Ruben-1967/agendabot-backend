/**
 * src/services/emailAlertaCobroWeb.js
 *
 * Alerta interna para Multidigital cuando el cobro inicial de una suscripción web es
 * rechazado (ver src/lib/cobroInicialWeb.js). Flow no avisa los rechazos y el cliente ya
 * vio "tu tarjeta quedó inscrita", así que hay que contactarlo. Sale por Resend con la misma
 * cuenta que los demás correos de Multidigital. No lleva datos de tarjeta (solo los últimos 4).
 * Destino: ALERTA_COBROS_WEB_EMAIL, por defecto contacto@multidigital.cl.
 */

const { Resend } = require('resend');

const REMITENTE = 'noreply@multidigital.cl';
const DESTINO_POR_DEFECTO = 'contacto@multidigital.cl';

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatoMonto = (n) => `$${Number(n).toLocaleString('es-CL')}`;

function armarAlerta({ nombre, emailCliente, plan, monto, ref, tarjetaUltimos4 }) {
  const link = process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/web/suscribir/${ref}` : '';
  return {
    asunto: `Cobro rechazado: ${nombre}`,
    html: `
      <h2>El primer cobro de ${escapar(nombre)} fue rechazado</h2>
      <p>El cliente inscribió su tarjeta${tarjetaUltimos4 ? ` (terminada en ${escapar(tarjetaUltimos4)})` : ''}, pero el banco o Flow rechazó el cobro inicial de
      <b>${formatoMonto(monto)}</b> (plan ${plan === 'ANUAL' ? 'anual' : 'mensual'} + hosting del primer año).</p>
      <p><b>No se activó nada ni se le cobró.</b> El cliente vio "tu tarjeta quedó inscrita" y espera nuestro contacto.</p>
      <ul>
        <li>Correo del cliente: ${escapar(emailCliente)}</li>
        <li>Puede reintentar con otra tarjeta desde su mismo link${link ? `: ${escapar(link)}` : ''}</li>
      </ul>
      <p>Pídele que consulte con su banco si la tarjeta permite cargos automáticos por internet, o que use otra.</p>`,
  };
}

async function enviarAlertaCobroRechazado(datos) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const { asunto, html } = armarAlerta(datos);
  const r = await resend.emails.send({ from: REMITENTE, to: process.env.ALERTA_COBROS_WEB_EMAIL || DESTINO_POR_DEFECTO, subject: asunto, html });
  if (r.error) throw new Error(`Resend rechazó la alerta: ${JSON.stringify(r.error)}`);
}

// Cobro que lleva horas "cobrando" sin que Flow lo resuelva (no conoce la orden, o sigue pendiente).
async function enviarAlertaCobroSinResolver({ nombre, emailCliente, monto, ref, minutos, motivo }) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const link = process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/web/suscribir/${ref}` : '';
  const r = await resend.emails.send({
    from: REMITENTE,
    to: process.env.ALERTA_COBROS_WEB_EMAIL || DESTINO_POR_DEFECTO,
    subject: `Revisar a mano: cobro sin resolver de ${nombre}`,
    html: `
      <h2>Un cobro lleva ${Math.round(minutos / 60)} horas sin resolverse</h2>
      <p>El cliente <b>${escapar(nombre)}</b> (${escapar(emailCliente)}) inscribió su tarjeta, pero el cobro inicial de
      <b>${formatoMonto(monto)}</b> no se pudo confirmar en Flow.</p>
      <p>Motivo: ${escapar(motivo)}</p>
      <p>Revisa la orden en Flow. Si no se cobró, el cliente puede reintentar desde su link${link ? `: ${escapar(link)}` : ''}.</p>`,
  });
  if (r.error) throw new Error(`Resend rechazó la alerta: ${JSON.stringify(r.error)}`);
}

module.exports = { enviarAlertaCobroRechazado, enviarAlertaCobroSinResolver, armarAlerta };
