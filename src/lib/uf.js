/**
 * src/lib/uf.js
 *
 * Valor diario de la UF (Unidad de Fomento), para el cobro de hosting anual
 * (1 UF). Fuente: mindicador.cl (API pública del Banco Central de Chile,
 * sin autenticación).
 */

const MINDICADOR_UF_URL = 'https://mindicador.cl/api/uf';

/**
 * Devuelve el valor de la UF de hoy en CLP (redondeado al peso). Si la API
 * falla, propaga el error — quien llama decide cómo manejarlo (no hay un
 * valor "por defecto" seguro para cobrar dinero real).
 */
async function obtenerValorUfHoy() {
  const respuesta = await fetch(MINDICADOR_UF_URL);
  if (!respuesta.ok) {
    throw new Error(`mindicador.cl respondió ${respuesta.status}`);
  }
  const datos = await respuesta.json();
  const valor = datos?.serie?.[0]?.valor;
  if (typeof valor !== 'number' || valor <= 0) {
    throw new Error('mindicador.cl no devolvió un valor de UF válido');
  }
  return Math.round(valor);
}

module.exports = { obtenerValorUfHoy };
