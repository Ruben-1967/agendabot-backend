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

/**
 * Envía un mensaje de PLANTILLA por WhatsApp (obligatorio para mensajes
 * iniciados por el negocio, fuera de la ventana de 24h de servicio).
 *
 * @param {Object} params
 * @param {string} params.phoneNumberId
 * @param {string} params.to
 * @param {string} params.accessToken
 * @param {string} params.templateName - Nombre exacto de la plantilla aprobada (ej. 'recordatorio_control_anual').
 * @param {string[]} params.variables - Valores en orden para {{1}}, {{2}}, etc. del body.
 */
async function sendWhatsAppTemplateMessage({ phoneNumberId, to, accessToken, templateName, variables = [] }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const components = variables.length > 0
    ? [{
        type: 'body',
        parameters: variables.map((texto) => ({ type: 'text', text: texto })),
      }]
    : [];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es' },
        components,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error enviando plantilla de WhatsApp:', JSON.stringify(data, null, 2));
    throw new Error(`WhatsApp API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}

module.exports = { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage };
