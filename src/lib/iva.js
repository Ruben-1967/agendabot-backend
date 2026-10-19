/**
 * src/lib/iva.js
 *
 * Los precios de TotemSystem se publican NETOS (+ IVA) desde 2026-10-16 (decisión
 * del dueño; la promo de Ahorróptica ya se cobra con IVA: $9.900 + IVA = $11.781).
 * Flow cobra el monto del Plan tal cual, sin sumar IVA, así que lo que se cobra
 * es siempre el neto + IVA, redondeado al peso. Un solo lugar para esa cuenta.
 */

const TASA_IVA = 0.19;

/** Neto -> total con IVA, en pesos enteros. */
function conIva(neto) {
  return Math.round(neto * (1 + TASA_IVA));
}

module.exports = { TASA_IVA, conIva };
