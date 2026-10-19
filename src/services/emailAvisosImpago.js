/**
 * src/services/emailAvisosImpago.js
 *
 * Correos de la política de impago (ver src/lib/impagos.js). Salen por Resend con
 * la misma cuenta/remitente que el código de acceso (RESEND_API_KEY_MULTIDIGITAL,
 * noreply@multidigital.cl), a los usuarios ADMIN de la empresa. Se eligió correo
 * y no WhatsApp porque una plantilla de WhatsApp necesita aprobación de Meta
 * (días) y el correo del administrador ya existe en todas las empresas.
 */

const { Resend } = require('resend');
const prisma = require('../lib/prisma');

const REMITENTE = 'noreply@multidigital.cl';
const CONTACTO_COBRANZA = 'contacto@multidigital.cl';

const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatoFecha = (d) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const formatoMonto = (n) => `$${Number(n).toLocaleString('es-CL')}`;

function armarCorreo(tipo, { nombreEmpresa, monto, fechaCorte }) {
  const empresa = escapar(nombreEmpresa);
  const corte = formatoFecha(fechaCorte);
  const contacto = `<p>Para regularizar el pago, escríbenos a <a href="mailto:${CONTACTO_COBRANZA}">${CONTACTO_COBRANZA}</a> y te enviaremos un enlace seguro para actualizar tu tarjeta.</p>`;

  if (tipo === 'AVISO_1') {
    return {
      asunto: `No pudimos cobrar tu suscripción de TotemSystem (${nombreEmpresa})`,
      html: `
        <h2>No pudimos cobrar tu mensualidad</h2>
        <p>Intentamos cobrar la mensualidad de <b>${empresa}</b> (${formatoMonto(monto)} con IVA) y el pago fue rechazado.</p>
        <p><b>Tu servicio sigue funcionando con normalidad.</b> Si el pago no se regulariza antes del <b>${corte}</b>, el servicio se pausará.</p>
        ${contacto}`,
    };
  }
  if (tipo === 'AVISO_2') {
    return {
      asunto: `Último aviso: tu servicio de TotemSystem se pausará el ${corte}`,
      html: `
        <h2>Tu servicio se pausará el ${corte}</h2>
        <p>Seguimos sin poder cobrar la mensualidad de <b>${empresa}</b> (${formatoMonto(monto)} con IVA).</p>
        <p>Si no se regulariza antes del <b>${corte}</b>:</p>
        <ul>
          <li>El asistente de WhatsApp dejará de responder a tus clientes.</li>
          <li>Podrás seguir entrando al panel, ver tu información y editar tus clientes, pero no crear registros nuevos.</li>
          <li>Tus datos se conservan y puedes exportarlos.</li>
        </ul>
        <p>El servicio se reactiva apenas se regulariza el pago.</p>
        ${contacto}`,
    };
  }
  return {
    asunto: `Pausamos tu servicio de TotemSystem por pago pendiente (${nombreEmpresa})`,
    html: `
      <h2>Tu servicio está pausado</h2>
      <p>No logramos cobrar la mensualidad de <b>${empresa}</b> (${formatoMonto(monto)} con IVA) y venció el plazo del ${corte}.</p>
      <ul>
        <li>El asistente de WhatsApp está pausado.</li>
        <li>Puedes seguir entrando al panel para ver y editar tus clientes, pero no crear registros nuevos.</li>
        <li>Tus datos están a salvo y puedes exportarlos.</li>
      </ul>
      <p>El servicio se reactiva apenas se regulariza el pago.</p>
      ${contacto}`,
  };
}

/**
 * Envía el correo a todos los ADMIN de la empresa. Devuelve cuántos salieron;
 * lanza error si no había destinatarios o no salió ninguno (el llamador NO debe
 * avanzar la etapa en ese caso).
 */
async function enviarAvisoImpago(tipo, { empresaId, nombreEmpresa, monto, fechaCorte }) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const admins = await prisma.usuario.findMany({ where: { empresaId, rol: 'ADMIN' }, select: { email: true } });
  const destinos = admins.map((a) => a.email).filter(Boolean);
  if (!destinos.length) throw new Error('La empresa no tiene usuarios ADMIN con correo');

  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const { asunto, html } = armarCorreo(tipo, { nombreEmpresa, monto, fechaCorte });
  let enviados = 0;
  for (const to of destinos) {
    const r = await resend.emails.send({ from: REMITENTE, to, subject: asunto, html });
    if (r.error) {
      console.error(`[impagos] Resend rechazó el correo a ${to}:`, JSON.stringify(r.error));
    } else {
      enviados++;
    }
  }
  if (!enviados) throw new Error('Resend no aceptó ningún correo');
  return enviados;
}

module.exports = { enviarAvisoImpago, armarCorreo };
