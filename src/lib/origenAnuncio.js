// Anuncio de origen de un contacto de WhatsApp (2026-11-09): cuando alguien escribe desde un
// anuncio "Click to WhatsApp", Meta manda en el mensaje un objeto `referral` con el id del
// anuncio, su título y su texto. Antes se ignoraba, así que no había forma de saber qué campaña
// traía a los clientes que pagan. Se guarda al llegar el mensaje (la ficha de Clientes Web se
// crea después, cuando el bot deriva) y leadClienteWeb.js lo copia a la ficha.
// Nunca lanza: si algo falla, solo queda en el log y el mensaje se procesa igual.

const prisma = require('./prisma');

function recortar(valor, max) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  return v ? v.slice(0, max) : null;
}

/**
 * @param {Object} p
 * @param {string} p.phoneNumberId - número de WhatsApp del negocio que recibió el mensaje
 * @param {string} p.telefono - teléfono (o BSUID) del cliente
 * @param {Object} p.referral - mensaje.referral del webhook de WhatsApp
 */
async function guardarOrigenAnuncio({ phoneNumberId, telefono, referral }) {
  try {
    if (!referral || !phoneNumberId || !telefono) return;
    await prisma.origenAnuncio.create({
      data: {
        phoneNumberId: String(phoneNumberId),
        telefono: String(telefono),
        sourceId: recortar(referral.source_id, 100),
        sourceType: recortar(referral.source_type, 30),
        sourceUrl: recortar(referral.source_url, 500),
        titulo: recortar(referral.headline, 300),
        texto: recortar(referral.body, 1000),
        ctwaClid: recortar(referral.ctwa_clid, 300),
      },
    });
    console.log(`[ORIGEN ANUNCIO] Contacto desde ${referral.source_type || 'anuncio'} ${referral.source_id || '(sin id)'}`);
  } catch (error) {
    console.error('[ORIGEN ANUNCIO] No se pudo guardar:', error.message);
  }
}

// Un anuncio de hace meses no explica un interesado de hoy: solo cuenta si fue reciente.
const DIAS_VIGENCIA_ORIGEN = 30;

/** El anuncio más reciente (últimos 30 días) desde el que escribió este contacto a este número, o null. */
async function buscarOrigenAnuncio({ phoneNumberId, telefono, ahora = new Date() }) {
  if (!phoneNumberId || !telefono) return null;
  const desde = new Date(ahora.getTime() - DIAS_VIGENCIA_ORIGEN * 24 * 60 * 60 * 1000);
  return prisma.origenAnuncio.findFirst({
    where: { phoneNumberId: String(phoneNumberId), telefono: String(telefono), creadoEn: { gte: desde } },
    orderBy: { creadoEn: 'desc' },
  });
}

module.exports = { guardarOrigenAnuncio, buscarOrigenAnuncio };
