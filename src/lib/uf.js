/**
 * src/lib/uf.js
 *
 * Valor diario de la UF (Unidad de Fomento), para el cobro de hosting anual
 * (1 UF). Fuente principal: la tabla oficial del SII
 * (https://www.sii.cl/valores_y_fechas/uf/ufAAAA.htm, una fila por día y una
 * columna por mes). Respaldo: mindicador.cl, que cayó con un 502 el 2026-10-19 y
 * por eso ya no es la fuente principal. Si ambas fallan se propaga el error:
 * no hay un valor "por defecto" seguro para cobrar dinero real.
 */

const MINDICADOR_UF_URL = 'https://mindicador.cl/api/uf';
const UF_MIN_PLAUSIBLE = 10000; // la UF anda en ~$40.000; fuera de este rango algo se parseó mal
const UF_MAX_PLAUSIBLE = 100000;
const TIMEOUT_MS = 10000;

// Año, mes (1-12) y día del reloj de Chile; el SII publica por fecha chilena.
function fechaChile(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  const valor = (t) => Number(partes.find((p) => p.type === t).value);
  return { anio: valor('year'), mes: valor('month'), dia: valor('day') };
}

/**
 * Extrae del HTML de la tabla del SII el valor del día/mes pedido. "41.183,94" -> 41183.94.
 * Devuelve null si la celda está vacía (fecha futura) o no se encuentra.
 */
function parsearUfSii(html, dia, mes) {
  const filas = html.match(/<tr>\s*<th[^>]*>\s*\d+\s*<\/th>[\s\S]*?<\/tr>/g) || [];
  for (const fila of filas) {
    const numeroDia = Number(fila.match(/<th[^>]*>\s*(\d+)\s*<\/th>/)[1]);
    if (numeroDia !== dia) continue;
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/&nbsp;|\s/g, ''));
    const crudo = celdas[mes - 1];
    if (!crudo) return null;
    const valor = Number(crudo.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(valor) ? valor : null;
  }
  return null;
}

async function obtenerUfDesdeSii(ahora) {
  const { anio, mes, dia } = fechaChile(ahora);
  const respuesta = await fetch(`https://www.sii.cl/valores_y_fechas/uf/uf${anio}.htm`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotemSystem/1.0)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!respuesta.ok) throw new Error(`sii.cl respondió ${respuesta.status}`);
  const valor = parsearUfSii(new TextDecoder('latin1').decode(await respuesta.arrayBuffer()), dia, mes);
  if (valor === null) throw new Error(`sii.cl no tiene valor de UF para ${dia}/${mes}/${anio}`);
  return valor;
}

async function obtenerUfDesdeMindicador() {
  const respuesta = await fetch(MINDICADOR_UF_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!respuesta.ok) throw new Error(`mindicador.cl respondió ${respuesta.status}`);
  const datos = await respuesta.json();
  return datos?.serie?.[0]?.valor;
}

/**
 * Devuelve el valor de la UF de hoy en CLP (redondeado al peso): SII primero,
 * mindicador.cl si el SII falla. Lanza error si ninguna fuente da un valor plausible.
 */
async function obtenerValorUfHoy(ahora = new Date()) {
  const errores = [];
  for (const fuente of [() => obtenerUfDesdeSii(ahora), obtenerUfDesdeMindicador]) {
    try {
      const valor = await fuente();
      if (typeof valor === 'number' && valor >= UF_MIN_PLAUSIBLE && valor <= UF_MAX_PLAUSIBLE) {
        return Math.round(valor);
      }
      errores.push(`valor de UF no plausible (${valor})`);
    } catch (err) {
      errores.push(err.message);
    }
  }
  throw new Error(`No se pudo obtener la UF: ${errores.join(' | ')}`);
}

module.exports = { obtenerValorUfHoy, parsearUfSii };
