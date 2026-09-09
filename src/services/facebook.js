// Servicio de envío de mensajes por Messenger (Facebook) — canal nuevo
// (2026-09-09), habilitado solo para LuxVision por ahora (ver
// src/server.js, guardia EMPRESA_ID_LUXVISION en la rama de Messenger del
// webhook). Mirror de src/services/instagram.js: mismo criterio de
// aplanar `interactivo` a texto plano (Messenger tampoco tiene las listas
// interactivas nativas de WhatsApp).
//
// A diferencia de Instagram (que usa graph.instagram.com para tokens del
// flujo "Instagram API with Instagram Login" — ver instagram.js), el Page
// Access Token de Messenger SÍ funciona contra graph.facebook.com
// directamente — confirmado contra la documentación oficial antes de
// escribir esto, para no repetir el mismo bug.

const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');

const GRAPH_API_VERSION = 'v21.0';

/**
 * Messenger tampoco tiene listas interactivas nativas para días/horarios —
 * mismo criterio de contenido que armarTextoConInteractivo en instagram.js.
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
 * Envía un mensaje de texto simple por Messenger.
 *
 * @param {Object} params
 * @param {string} params.paginaId - Page id de Facebook de la empresa (el que envía).
 * @param {string} params.to - PSID (Page-Scoped ID) del destinatario.
 * @param {string} params.text - Contenido del mensaje.
 * @param {string} params.accessToken - Page Access Token de esa empresa.
 */
async function sendFacebookTextMessage({ paginaId, to, text, accessToken }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${paginaId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error enviando mensaje de Messenger:', JSON.stringify(data, null, 2));
    throw new Error(`Messenger API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}

module.exports = {
  sendFacebookTextMessage,
  armarTextoConInteractivo,
};
