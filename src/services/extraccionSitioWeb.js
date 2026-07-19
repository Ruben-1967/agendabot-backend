// Extrae información básica de un negocio a partir de su sitio web:
// nombre, dirección, teléfono, servicios sugeridos e información
// adicional en borrador. Es best-effort — sitios muy dependientes de
// JavaScript (SPA) pueden devolver poco o nada útil, ya que esto hace
// un fetch simple del HTML, sin navegador headless.
//
// IMPORTANTE: esta función NUNCA escribe en la base de datos. Su
// resultado siempre debe pasar por revisión humana antes de guardarse
// (ya sea en el alta de una demo, o en el panel de "Información del
// negocio" para clientes reales).

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PAGINAS_ADICIONALES = 3;
const MAX_CARACTERES_POR_PAGINA = 6000;

function limpiarHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CARACTERES_POR_PAGINA);
}

async function obtenerTextoDePagina(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const html = await response.text();
    return limpiarHtml(html);
  } catch (err) {
    console.error(`No se pudo leer ${url}:`, err.message);
    return null;
  }
}

/**
 * @param {string} urlPrincipal
 * @returns {Promise<{exito: boolean, error?: string, nombreNegocio?: string|null, direccion?: string|null, telefono?: string|null, serviciosSugeridos?: string[], informacionAdicionalSugerida?: string}>}
 */
async function extraerInfoSitioWeb(urlPrincipal) {
  const textoHome = await obtenerTextoDePagina(urlPrincipal);
  if (!textoHome) {
    return { exito: false, error: 'No se pudo acceder al sitio web.' };
  }

  const rutasComunes = ['/contacto', '/nosotros', '/quienes-somos', '/local'];
  const base = urlPrincipal.replace(/\/$/, '');
  const textosAdicionales = [];

  for (const ruta of rutasComunes.slice(0, MAX_PAGINAS_ADICIONALES)) {
    const texto = await obtenerTextoDePagina(base + ruta);
    if (texto) textosAdicionales.push(texto);
  }

  const textoCompleto = [textoHome, ...textosAdicionales].join('\n\n---\n\n');

  const systemPrompt = `Extraes información de negocio a partir de texto de un sitio web. Responde ÚNICAMENTE con un JSON válido, sin texto adicional ni comillas de markdown. Formato exacto:
{
  "nombreNegocio": string o null,
  "direccion": string o null,
  "telefono": string o null,
  "serviciosSugeridos": [string],
  "informacionAdicionalSugerida": string
}
Si no encuentras un dato, pon null (o arreglo vacío para servicios). NUNCA inventes información que no esté en el texto.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: textoCompleto }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const datos = JSON.parse(textBlock.text);
    return { exito: true, ...datos };
  } catch (err) {
    console.error('Error extrayendo/parseando información del sitio web:', err.message);
    return { exito: false, error: 'No se pudo interpretar la información extraída.' };
  }
}

module.exports = { extraerInfoSitioWeb };