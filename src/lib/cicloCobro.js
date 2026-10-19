/**
 * src/lib/cicloCobro.js
 *
 * Cobro anclado a un día fijo del mes (Suscripcion.cobroDiaMes, decisión
 * 2026-10-19, Ahorróptica: día 7): el cliente paga el mes en curso al registrar
 * la tarjeta (el cobro combinado de /customer/collect, sin cambios) y la
 * suscripción recurrente de Flow arranca para que su PRIMER cobro caiga ese día
 * del MES SIGUIENTE, y de ahí en adelante cada mes ese día. Sin esto el siguiente
 * cobro cae 30 días después de registrar la tarjeta, una fecha distinta según el
 * día en que el cliente se decida a pagar.
 *
 * La suscripción de Flow se crea con trial_period_days (ver
 * activarSuscripcionPorCobroFlow.js); acá se calcula cuántos días de trial
 * hacen falta para aterrizar en ese día. Se cuentan días de CALENDARIO en hora
 * de Chile (no 24 h exactas): si el servidor (UTC) ya está en el día siguiente
 * pero en Chile todavía es hoy, vale la fecha de Chile.
 *
 * Siempre es el mes siguiente (aunque el día de cobro todavía no haya pasado
 * este mes): si no, registrarse el 3 con cobro el 7 cobraría dos veces en 4 días.
 */

const ZONA_CHILE = 'America/Santiago';
const DIA_MES_MAXIMO = 28; // existe en todos los meses (incluido febrero)

/** Año, mes (1-12) y día de `fecha` según el reloj de Chile. */
function fechaEnChile(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha);
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return { anio: valor('year'), mes: valor('month'), dia: valor('day') };
}

/**
 * Días de calendario (hora de Chile) desde `ahora` hasta el día `diaMes` del mes
 * siguiente. `diaMes` debe ser un entero entre 1 y 28.
 */
function diasHastaProximoCobro(ahora, diaMes) {
  if (!Number.isInteger(diaMes) || diaMes < 1 || diaMes > DIA_MES_MAXIMO) {
    throw new Error(`cobroDiaMes inválido: ${diaMes} (debe ser un entero entre 1 y ${DIA_MES_MAXIMO})`);
  }
  const { anio, mes, dia } = fechaEnChile(ahora);
  // Date.UTC normaliza el mes 12 -> enero del año siguiente.
  const hoy = Date.UTC(anio, mes - 1, dia);
  const proximoCobro = Date.UTC(anio, mes, diaMes);
  return Math.round((proximoCobro - hoy) / 86400000);
}

module.exports = { diasHastaProximoCobro, fechaEnChile, DIA_MES_MAXIMO };
