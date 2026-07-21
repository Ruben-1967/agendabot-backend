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

/**
 * Envía un mensaje INTERACTIVO de lista (botón que despliega hasta 10 filas
 * seleccionables, repartidas en hasta 10 secciones). Solo se puede enviar
 * dentro de la ventana de servicio de 24h (es decir, después de que el
 * cliente respondió algo) — no sirve para iniciar una conversación.
 *
 * Soporta dos formas de pasar las filas:
 *  - `secciones`: agrupadas con título propio (ej. "Mañana"/"Tarde", o
 *    "Próximos días con hora") — usar para listas nuevas con mejor formato.
 *  - `filas`: forma antigua, lista plana sin agrupar — se sigue soportando
 *    tal cual para no romper integraciones existentes (ej. catálogo rotativo).
 *
 * @param {Object} params
 * @param {string} params.phoneNumberId
 * @param {string} params.to
 * @param {string} params.accessToken
 * @param {string} params.textoCuerpo - Mensaje principal.
 * @param {string} params.textoBoton - Texto del botón que despliega la lista.
 * @param {{titulo: string, filas: {id: string, titulo: string, descripcion?: string}[]}[]} [params.secciones]
 * @param {{id: string, titulo: string, descripcion?: string}[]} [params.filas]
 * @param {string} [params.textoHeader] - Texto corto en negrita arriba del cuerpo (ej. nombre del negocio). Máx. 60 caracteres.
 * @param {string} [params.textoFooter] - Texto pequeño abajo del cuerpo. Máx. 60 caracteres.
 */
async function sendWhatsAppInteractiveList({
  phoneNumberId,
  to,
  accessToken,
  textoCuerpo,
  textoBoton,
  secciones,
  filas,
  textoHeader,
  textoFooter,
}) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const seccionesFinales = secciones && secciones.length > 0
    ? secciones.slice(0, 10).map((seccion) => ({
        title: seccion.titulo.slice(0, 24),
        rows: seccion.filas.slice(0, 10).map((fila) => ({
          id: fila.id,
          title: fila.titulo.slice(0, 24),
          description: fila.descripcion ? fila.descripcion.slice(0, 72) : undefined,
        })),
      }))
    : [{
        title: 'Disponible hoy',
        rows: (filas || []).slice(0, 10).map((fila) => ({
          id: fila.id,
          title: fila.titulo.slice(0, 24),
          description: fila.descripcion ? fila.descripcion.slice(0, 72) : undefined,
        })),
      }];

  const interactive = {
    type: 'list',
    body: { text: textoCuerpo },
    action: {
      button: textoBoton,
      sections: seccionesFinales,
    },
  };

  if (textoHeader) {
    interactive.header = { type: 'text', text: textoHeader.slice(0, 60) };
  }
  if (textoFooter) {
    interactive.footer = { text: textoFooter.slice(0, 60) };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error enviando lista interactiva de WhatsApp:', JSON.stringify(data, null, 2));
    throw new Error(`WhatsApp API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}

/**
 * Codifica una fecha+hora en el id de fila que WhatsApp devuelve cuando el
 * cliente toca una opción de la lista interactiva de horarios de agendamiento.
 * Formato: "horario|YYYY-MM-DD|HH:MM"
 */
function codificarFilaHorario(fecha, hora) {
  return `horario|${fecha}|${hora}`;
}

/**
 * Inverso de codificarFilaHorario. Devuelve null si el id no tiene el
 * formato esperado (ej. viene de otro tipo de lista interactiva, como el
 * catálogo rotativo).
 */
function decodificarFilaHorario(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 3 || partes[0] !== 'horario') return null;
  const [, fecha, hora] = partes;
  return { fecha, hora };
}

/**
 * Codifica una fecha en el id de fila que WhatsApp devuelve cuando el
 * cliente toca un DÍA de la lista interactiva de "próximos días con hora".
 * Formato: "dia|YYYY-MM-DD"
 */
function codificarFilaDia(fecha) {
  return `dia|${fecha}`;
}

/**
 * Inverso de codificarFilaDia. Devuelve null si el id no tiene el formato
 * esperado.
 */
function decodificarFilaDia(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 2 || partes[0] !== 'dia') return null;
  return { fecha: partes[1] };
}

function codificarFilaProductoDemo(productoId) {
  return `demoproducto|${productoId}`;
}

function decodificarFilaProductoDemo(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 2 || partes[0] !== 'demoproducto') return null;
  return partes[1];
}

/**
 * Codifica el id de un Servicio real en el id de fila para la lista
 * interactiva de selección de servicio (agendamiento real). Formato:
 * "servicio|<servicioId>"
 */
function codificarFilaServicio(servicioId) {
  return `servicio|${servicioId}`;
}

function decodificarFilaServicio(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 2 || partes[0] !== 'servicio') return null;
  return partes[1];
}

/**
 * Codifica el ÍNDICE de un servicio dentro del arreglo serviciosBase del
 * rubro (la demo no tiene Servicio reales en la base, solo strings
 * sugeridos por RubroTemplate) — formato: "demoservicio|<indice>"
 */
function codificarFilaServicioDemo(indice) {
  return `demoservicio|${indice}`;
}

function decodificarFilaServicioDemo(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 2 || partes[0] !== 'demoservicio') return null;
  const indice = Number(partes[1]);
  return Number.isInteger(indice) ? indice : null;
}

const ID_FILA_SERVICIO_OTRO_DEMO = 'demoservicio_otro';


// Id fijo para la fila "Otro / no lo encuentro" en la lista de servicios —
// no necesita decodificarse, se compara directo contra este valor.
const ID_FILA_SERVICIO_OTRO = 'servicio_otro';




/**
 * Codifica producto+cantidad en el id de fila para la lista interactiva de
 * cantidad (demo de catálogo). Formato: "demoscantidad|productoId|cantidad"
 * — cantidad puede ser un número (1-6) o el string "otra" (pide escribirla).
 */
function codificarFilaCantidadDemo(productoId, cantidad) {
  return `demoscantidad|${productoId}|${cantidad}`;
}

/**
 * Inverso de codificarFilaCantidadDemo. Devuelve { productoId, cantidadRaw }
 * sin convertir "otra" a número — eso lo decide quien la use.
 */
function decodificarFilaCantidadDemo(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 3 || partes[0] !== 'demoscantidad') return null;
  return { productoId: partes[1], cantidadRaw: partes[2] };
}

/**
 * Codifica la elección de rubro en el menú genérico (número desconocido
 * que escribe al número de demo). Formato: "rubrogenerico|id"
 */
function codificarFilaRubroGenerico(id) {
  return `rubrogenerico|${id}`;
}

function decodificarFilaRubroGenerico(id) {
  if (typeof id !== 'string') return null;
  const partes = id.split('|');
  if (partes.length !== 2 || partes[0] !== 'rubrogenerico') return null;
  return partes[1];
}

module.exports = {
  sendWhatsAppTextMessage,
  sendWhatsAppTemplateMessage,
  sendWhatsAppInteractiveList,
  codificarFilaHorario,
  decodificarFilaHorario,
  codificarFilaDia,
  decodificarFilaDia,
  codificarFilaProductoDemo,
  decodificarFilaProductoDemo,
  codificarFilaCantidadDemo,
  decodificarFilaCantidadDemo,
  codificarFilaRubroGenerico,
  decodificarFilaRubroGenerico,
  codificarFilaServicio,
  decodificarFilaServicio,
  ID_FILA_SERVICIO_OTRO,
  codificarFilaServicioDemo,
  decodificarFilaServicioDemo,
  ID_FILA_SERVICIO_OTRO_DEMO,
};