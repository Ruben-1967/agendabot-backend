// Precios netos de la suscripción web de Multidigital (sitio web + correos).
// Fuente única: la usan el script que crea los planes en Flow (lo que Flow
// cobra) y el que crea los links (lo que la página le muestra al cliente).
// Si cambian, hay que crear planes nuevos en Flow: el monto de un plan con
// suscripciones activas no se puede editar.
const { conIva } = require('./iva');

const PRECIOS_NETOS_WEB = { MENSUAL: 9900, ANUAL: 95000 };

// Descuento sobre el hosting del PRIMER año (decisión de Rubén, 2026-10-29):
// 50% hasta el 31-oct, 20% durante noviembre. Pasado noviembre no hay promo
// (1 UF + IVA completo) hasta que se defina otra: agregar un tramo acá.
// "hasta" es el último día (inclusive) en hora de Chile, formato AAAA-MM-DD.
const TRAMOS_DESCUENTO_HOSTING_1ER_ANIO = [
  { hasta: '2026-10-31', descuento: 0.5 },
  { hasta: '2026-11-30', descuento: 0.2 },
];

// Día calendario de Chile de `fecha`, "AAAA-MM-DD" (compara bien como texto).
function diaChileTexto(fecha) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
}

function descuentoHostingPrimerAnio(fecha = new Date()) {
  const dia = diaChileTexto(fecha);
  const tramo = TRAMOS_DESCUENTO_HOSTING_1ER_ANIO.find((t) => dia <= t.hasta);
  return tramo ? tramo.descuento : 0;
}

/**
 * Lo que se cobra al registrar la tarjeta (con IVA): el plan del primer
 * período + el hosting del primer año con el descuento vigente. El hosting
 * completo (1 UF + IVA) recién se cobra en cada aniversario.
 * @param {Object} p
 * @param {number} p.montoPlanConIva  - lo que cobra Flow por período del plan
 * @param {number} p.valorUf          - valor de la UF del día
 * @param {Date}   [p.fecha]
 */
function calcularCobroInicial({ montoPlanConIva, valorUf, fecha = new Date() }) {
  const descuento = descuentoHostingPrimerAnio(fecha);
  const montoHosting = conIva(valorUf * (1 - descuento));
  return {
    descuento,
    montoPlan: montoPlanConIva,
    montoHosting,
    montoHostingCompleto: conIva(valorUf),
    total: montoPlanConIva + montoHosting,
  };
}

module.exports = { PRECIOS_NETOS_WEB, descuentoHostingPrimerAnio, calcularCobroInicial, diaChileTexto, TRAMOS_DESCUENTO_HOSTING_1ER_ANIO };
