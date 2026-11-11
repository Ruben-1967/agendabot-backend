/**
 * src/services/emailInteresadoWeb.js
 *
 * Asistente 24/7 de sitios web (2026-11-11): correo al negocio cuando una persona deja sus
 * datos en el chat de su sitio. Lleva los datos, qué necesita, un botón para responderle por
 * WhatsApp con un saludo ya escrito y la conversación completa. Sale por Resend con la
 * cuenta de Multidigital (mismo remitente que los demás correos). Copia a Multidigital
 * (CHAT_WEB_COPIA_AVISOS, por defecto contacto@multidigital.cl) para seguir el servicio.
 */

const { Resend } = require('resend');

const REMITENTE = 'Asistente 24/7 · Multidigital <noreply@multidigital.cl>';
const COPIA_POR_DEFECTO = 'contacto@multidigital.cl';

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fechaChile(fecha) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(fecha);
}

/**
 * Arma el correo (sin enviarlo). Función pura: se prueba sin red.
 * @param {Object} p
 * @param {Object} p.asistente - config del asistente (titulo, nombreNegocio)
 * @param {Object} p.datos - { nombre, telefono (solo dígitos o null), telefonoEscrito, correo, necesidad }
 * @param {Array} p.mensajes - [{rol, contenido}]
 * @param {Date} [p.ahora]
 */
function armarCorreoInteresado({ asistente, datos, mensajes, ahora = new Date() }) {
  const negocio = asistente.nombreNegocio || asistente.titulo;
  const nombre = datos.nombre || 'Una persona interesada';
  const saludo = `Hola${datos.nombre ? ` ${datos.nombre.split(' ')[0]}` : ''}, te escribo de ${negocio} por tu consulta en nuestro sitio web.`;
  const linkWhatsApp = datos.telefono ? `https://wa.me/${datos.telefono}?text=${encodeURIComponent(saludo)}` : null;

  const filas = [
    ['Nombre', datos.nombre],
    ['WhatsApp', datos.telefono ? `+${datos.telefono}` : datos.telefonoEscrito],
    ['Correo', datos.correo],
    ['Qué necesita', datos.necesidad],
  ].filter(([, v]) => v);

  const conversacion = mensajes
    .filter((m) => m.rol === 'usuario' || m.rol === 'asistente')
    .map((m) => `<p style="margin:0 0 8px"><b style="color:${m.rol === 'usuario' ? '#0B1D3A' : '#1D4ED8'}">${m.rol === 'usuario' ? 'Cliente' : 'Asistente'}:</b> ${escapar(m.contenido).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const asunto = `🔔 Nuevo interesado desde tu sitio web: ${datos.nombre || 'sin nombre'}`;
  const html = `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0B1D3A">
  <h2 style="margin:0 0 6px">${escapar(nombre)} pidió que lo contactes</h2>
  <p style="margin:0 0 18px;color:#475569">Escribió en el chat de tu sitio web el ${escapar(fechaChile(ahora))}.</p>
  <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
    ${filas.map(([k, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;color:#475569;width:130px">${k}</td><td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-weight:600">${escapar(v)}</td></tr>`).join('')}
  </table>
  ${linkWhatsApp
    ? `<p style="margin:0 0 24px"><a href="${escapar(linkWhatsApp)}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Responder por WhatsApp</a></p>`
    : '<p style="margin:0 0 24px;color:#B45309"><b>No dejó un número de WhatsApp válido:</b> revisa la conversación para ver cómo contactarlo.</p>'}
  <h3 style="margin:0 0 4px;font-size:15px">Conversación completa</h3>
  <p style="margin:0 0 10px;font-size:12px;color:#94A3B8">Lo que escribió la persona se muestra tal cual: no abras enlaces que no esperas.</p>
  <div style="background:#F4F6FA;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.5">${conversacion}</div>
  <p style="margin:22px 0 0;font-size:12px;color:#94A3B8">Aviso automático del Asistente 24/7 de tu sitio web, un servicio de Multidigital.</p>
</div>`;
  return { asunto, html };
}

async function enviarAvisoInteresado({ asistente, datos, mensajes }) {
  if (!process.env.RESEND_API_KEY_MULTIDIGITAL) throw new Error('Falta RESEND_API_KEY_MULTIDIGITAL en el entorno');
  const destinos = (asistente.correoAvisos || []).filter(Boolean);
  const copia = process.env.CHAT_WEB_COPIA_AVISOS === '' ? null : (process.env.CHAT_WEB_COPIA_AVISOS || COPIA_POR_DEFECTO);
  const para = destinos.length ? destinos : [copia].filter(Boolean);
  if (!para.length) throw new Error('El asistente no tiene correo de avisos');
  const bcc = copia && !para.includes(copia) ? [copia] : undefined;
  const { asunto, html } = armarCorreoInteresado({ asistente, datos, mensajes });
  const resend = new Resend(process.env.RESEND_API_KEY_MULTIDIGITAL);
  const r = await resend.emails.send({ from: REMITENTE, to: para, ...(bcc ? { bcc } : {}), subject: asunto, html });
  if (r.error) throw new Error(`Resend rechazó el aviso: ${JSON.stringify(r.error)}`);
}

module.exports = { armarCorreoInteresado, enviarAvisoInteresado };
