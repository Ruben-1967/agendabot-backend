/**
 * src/lib/cicloCobro.js
 *
 * Cobro anclado al día 1 de cada mes (Suscripcion.cobroDia1, decisión
 * 2026-10-19, Ahorróptica): el cliente paga el mes en curso al registrar la
 * tarjeta (el cobro combinado de /customer/collect, sin cambios) y la
 * suscripción recurrente de Flow arranca para que su PRIMER cobro caiga el día
 * 1 del mes siguiente, y de ahí en adelante cada día 1. Sin esto el siguiente
 * cobro cae 30 días después de registrar la tarjeta, que es una fecha distinta
 * según el día en que el cliente se decida a pagar.
 *
 * La suscripción de Flow se crea con trial_period_days (ver
 * activarSuscripcionPorCobroFlow.js); acá se calcula cuántos días de trial
 * hacen falta para aterrizar en el día 1. Se cuentan días de CALENDARIO en
 * hora de Chile (no 24 h exactas): si el servidor (UTC) ya está en el día
 * siguiente pero en Chile todavía es hoy, vale la fecha de Chile.
 */

const ZONA_CHILE = 'America/Santiago';

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
 * Días de calendario (hora de Chile) desde `ahora` hasta el próximo día 1 de
 * mes (siempre el del mes siguiente: si hoy es día 1, es ~30 días). Mínimo 1.
 */
function diasHastaProximoDia1(ahora = new Date()) {
  const { anio, mes, dia } = fechaEnChile(ahora);
  // Date.UTC normaliza el mes 12 -> enero del año siguiente.
  const hoy = Date.UTC(anio, mes - 1, dia);
  const proximoDia1 = Date.UTC(anio, mes, 1);
  return Math.round((proximoDia1 - hoy) / 86400000);
}

module.exports = { diasHastaProximoDia1, fechaEnChile };
