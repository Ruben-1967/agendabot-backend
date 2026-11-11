// Asistente 24/7 para sitios web (chat del sitio, canal 'web') — piloto 2026-11-11.
//
// Cada sitio con asistente tiene una "clave" pública (va en el <script> del widget, no es
// un secreto) que apunta a una Empresa de AgendaBot en modo informativo: el asistente
// responde con su información y su guion, igual que el bot de WhatsApp.
//
// Piloto: solo Multidigital, en su propio sitio. Cuando haya clientes, esta lista pasa a
// la base de datos (campos en Empresa) para administrarla desde el panel.

const { EMPRESA_ID_CLIENTES_WEB } = require('./leadClienteWeb');

const ASISTENTES_WEB = {
  multidigital: {
    empresaId: EMPRESA_ID_CLIENTES_WEB,
    titulo: 'Asistente Multidigital',
    saludo: '¡Hola! 👋 Soy el asistente de Multidigital. ¿Quieres saber cómo tener el sitio web de tu negocio? Pregúntame lo que quieras.',
    color: '#1D4ED8',
    whatsapp: '56966108858',
    // Sitios desde donde se puede usar (el navegador manda el Origin; se compara el host).
    origenes: ['multidigital.cl', 'www.multidigital.cl', 'muestras.multidigital.cl'],
    // Plan Asistente: 150 conversaciones nuevas al mes (las ya iniciadas siguen).
    conversacionesMes: 150,
  },
};

// Por sesión de chat (una persona en el sitio): tope de mensajes, para que nadie pueda
// generar costo ilimitado con una sola conversación.
const MAX_MENSAJES_POR_SESION = 30;
const MAX_LARGO_MENSAJE = 800;
const MAX_CONVERSACIONES_NUEVAS_POR_IP_DIA = 5;
const REGEX_SESION = /^[A-Za-z0-9_-]{16,64}$/;

function asistentePorClave(clave) {
  return Object.prototype.hasOwnProperty.call(ASISTENTES_WEB, clave) ? ASISTENTES_WEB[clave] : null;
}

// Hostname del Origin si está en la lista del asistente. En pruebas locales se puede
// permitir localhost con CHAT_WEB_PERMITIR_LOCALHOST=1 (nunca en producción).
function origenPermitido(asistente, origin) {
  if (!asistente || !origin) return false;
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  if (asistente.origenes.includes(host)) return true;
  return process.env.CHAT_WEB_PERMITIR_LOCALHOST === '1' && (host === 'localhost' || host === '127.0.0.1');
}

// Inicio del mes actual en Chile (UTC-3/-4), para contar las conversaciones del plan.
function inicioMesChile(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' }).format(ahora);
  const [anio, mes] = partes.split('-').map(Number);
  // Medianoche del día 1 en Chile: se prueba con -3 y -4 h y se toma la que cae en ese mes.
  for (const offset of [3, 4]) {
    const candidato = new Date(Date.UTC(anio, mes - 1, 1, offset));
    const mesChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(candidato);
    if (mesChile.startsWith(`${String(mes).padStart(2, '0')}-01, 00`)) return candidato;
  }
  return new Date(Date.UTC(anio, mes - 1, 1, 3));
}

module.exports = {
  ASISTENTES_WEB, MAX_MENSAJES_POR_SESION, MAX_LARGO_MENSAJE, REGEX_SESION, MAX_CONVERSACIONES_NUEVAS_POR_IP_DIA,
  asistentePorClave, origenPermitido, inicioMesChile,
};
