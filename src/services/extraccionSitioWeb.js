// Extrae información básica de un negocio a partir de su sitio web:
// nombre, dirección, teléfono, servicios/productos sugeridos e información
// adicional en borrador. Es best-effort — sitios muy dependientes de
// JavaScript (SPA) pueden devolver poco o nada útil, ya que esto hace
// un fetch simple del HTML, sin navegador headless.
//
// IMPORTANTE: esta función NUNCA escribe en la base de datos. Su
// resultado siempre debe pasar por revisión humana antes de guardarse
// como información de un negocio real. Para demos comerciales, la carga
// automática de productosSugeridos es aceptable sin revisión previa,
// ya que no representa a un cliente real pagando.

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PAGINAS_ADICIONALES = 3;
const MAX_CARACTERES_POR_PAGINA = 20000;

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
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      },
    });

    const html = await response.text();

    // DIAGNÓSTICO PURO — no cambia el comportamiento, solo deja ver en los
    // logs de Render exactamente qué llegó de verdad, para decidir con
    // datos reales si el problema es un bloqueo tipo Cloudflare, un error
    // HTTP real, o una SPA sin contenido — en vez de seguir adivinando.
    console.log(`[DIAGNOSTICO extraccionSitioWeb] URL: ${url}`);
    console.log(`[DIAGNOSTICO extraccionSitioWeb] Status HTTP: ${response.status} ${response.statusText}`);
    console.log(`[DIAGNOSTICO extraccionSitioWeb] Largo del HTML recibido: ${html.length} caracteres`);
    console.log(`[DIAGNOSTICO extraccionSitioWeb] Primeros 300 caracteres:\n${html.slice(0, 300)}`);
    console.log(`[DIAGNOSTICO extraccionSitioWeb] ¿Menciona "cloudflare" o "checking your browser"?: ${/cloudflare|checking your browser|cf-browser-verification/i.test(html)}`);

    if (!response.ok) return null;
    return limpiarHtml(html);
  } catch (err) {
    console.error(`[DIAGNOSTICO extraccionSitioWeb] Error de red en ${url}:`, err.message);
    return null;
  }
}

/**
 * @param {string} urlPrincipal
 * @param {string[]} rutasAdicionales - rutas a intentar además de la home,
 *   ej. ['/pedir', '/menu', '/productos']. Útil para catálogos que viven
 *   en una subpágina, como pasó con Qroll (/pedir).
 * @returns {Promise<{exito: boolean, error?: string, nombreNegocio?: string|null, direccion?: string|null, telefono?: string|null, serviciosSugeridos?: string[], productosSugeridos?: {nombre: string, precio: number, descripcion?: string}[], informacionAdicionalSugerida?: string}>}
 */
async function extraerInfoSitioWeb(urlPrincipal, rutasAdicionales = []) {
  const textoHome = await obtenerTextoDePagina(urlPrincipal);
  if (!textoHome) {
    return { exito: false, error: 'No se pudo acceder al sitio web.' };
  }

  const rutasComunes = rutasAdicionales.length > 0
    ? rutasAdicionales
    : ['/contacto', '/nosotros', '/quienes-somos', '/local'];

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
  "productosSugeridos": [{"nombre": string, "precio": number, "descripcion": string o null}],
  "informacionAdicionalSugerida": string
}
"productosSugeridos" solo aplica si el sitio muestra un catálogo de productos individuales con precio (ej. tienda, panadería, restorán) — si el negocio ofrece servicios sin catálogo de productos (ej. óptica, clínica), deja "productosSugeridos" como arreglo vacío. El precio debe ser un número entero (sin símbolo de moneda ni puntos de miles). Extrae como máximo 15 productos representativos, no todos si hay muchos. Si no encuentras un dato, pon null (o arreglo vacío). NUNCA inventes información que no esté en el texto.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: textoCompleto }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const textoLimpio = textBlock.text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const datos = JSON.parse(textoLimpio);
    return { exito: true, ...datos };
  } catch (err) {
    console.error('Error extrayendo/parseando información del sitio web:', err.message);
    return { exito: false, error: 'No se pudo interpretar la información extraída.' };
  }
}

module.exports = { extraerInfoSitioWeb };