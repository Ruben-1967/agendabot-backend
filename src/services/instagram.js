// Servicio de envío de mensajes por Instagram Direct (Messaging API) — canal
// nuevo (2026-09-08), habilitado solo para LuxVision por ahora (ver
// src/server.js, guardia EMPRESA_ID_LUXVISION en la rama de Instagram del
// webhook). Mirror mínimo de src/services/whatsapp.js: a diferencia de
// WhatsApp, Instagram no tiene listas interactivas nativas para
// horarios/días — cualquier `interactivo` se traduce a texto plano antes de
// llegar acá (ver server.js).

const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');

const GRAPH_API_VERSION = 'v21.0';

/**
 * Instagram no tiene listas interactivas nativas (días/horarios/servicios,
 * ver sendWhatsAppInteractiveList en whatsapp.js) — esta función traduce
 * cualquier `interactivo` devuelto por procesarMensajeEntrante a texto plano
 * para agregarlo al mensaje de respuesta. Mismo criterio de contenido que
 * las ramas equivalentes de src/server.js para WhatsApp, solo que en texto.
 */
function armarTextoConInteractivo(respuestaTexto, interactivo) {
  if (!interactivo) return respuestaTexto;

  if (interactivo.tipo === 'lista_dias') {
    const dias = interactivo.dias.map((d) => `- ${fechaLegibleDesdeISO(d.fecha)}`).join('\n');
    return `${respuestaTexto}\n\n${dias}`;
  }

  if (interactivo.tipo === 'lista_horarios') {
    return `${respuestaTexto}\n\n${interactivo.horas.join(', ')}`;
  }

  if (interactivo.tipo === 'horarios_por_bloque') {
    const bloques = interactivo.bloques
      .map((b) => `${b.etiqueta}: ${b.horas.join(', ')}`)
      .join('\n');
    return `${respuestaTexto}\n\n${bloques}`;
  }

  if (interactivo.tipo === 'catalogo_imagenes') {
    const items = interactivo.items.map((i) => `- ${i.nombre}`).join('\n');
    return `${respuestaTexto}\n\n${items}`;
  }

  if (interactivo.tipo === 'lista_servicios') {
    const servicios = interactivo.servicios.map((s) => `- ${s.nombre}`).join('\n');
    return `${respuestaTexto}\n\n${servicios}`;
  }

  return respuestaTexto;
}

/**
 * Envía un mensaje de texto simple por Instagram Direct.
 *
 * @param {Object} params
 * @param {string} params.igCuentaId - Instagram business account id de la empresa (el que envía).
 * @param {string} params.to - IGSID del destinatario (id de Instagram del contacto, no un username).
 * @param {string} params.text - Contenido del mensaje.
 * @param {string} params.accessToken - Token de acceso de Instagram para esa empresa.
 */
async function sendInstagramTextMessage({ igCuentaId, to, text, accessToken }) {
  // graph.instagram.com, no graph.facebook.com (2026-09-09): el token que
  // usamos viene del flujo "Instagram API with Instagram Login" (login
  // directo con Instagram, sin Facebook Page de por medio — prefijo IGAA),
  // no de "Facebook Login for Business". Meta rechazaba con "Invalid OAuth
  // access token - Cannot parse access token" (code 190) al pegarle a
  // graph.facebook.com con un token de este tipo — confirmado con el
  // primer mensaje real a LuxVision.
  const url = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igCuentaId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error enviando mensaje de Instagram:', JSON.stringify(data, null, 2));
    throw new Error(`Instagram API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}

module.exports = {
  sendInstagramTextMessage,
  armarTextoConInteractivo,
};
