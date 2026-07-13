// Servicio de envío de mensajes por WhatsApp Cloud API.
// Node 24 (usado en Render) trae fetch nativo, no hace falta instalar nada extra.

const GRAPH_API_VERSION = 'v21.0';

/**
 * Envía un mensaje de texto simple por WhatsApp.
 *
 * @param {Object} params
 * @param {string} params.phoneNumberId - Phone Number ID de la empresa (el número que envía).
 * @param {string} params.to - Número de destino en formato internacional, sin '+' (ej. '56912345678').
 * @param {string} params.text - Contenido del mensaje.
 * @param {string} params.accessToken - Token de acceso de WhatsApp para esa empresa.
 */
async function sendWhatsAppTextMessage({ phoneNumberId, to, text, accessToken }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error enviando mensaje de WhatsApp:', JSON.stringify(data, null, 2));
    throw new Error(`WhatsApp API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}

module.exports = { sendWhatsAppTextMessage };
