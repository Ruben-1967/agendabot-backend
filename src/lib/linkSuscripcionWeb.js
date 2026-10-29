// Crea el link de suscripción web de Multidigital (sitio web + correos) para un
// cliente: una fila SuscripcionWeb con su `ref` único. Lo usan el panel
// (src/routes/clientesWeb.js) y scripts/crear-link-suscripcion-web.js.

const crypto = require('crypto');
const prisma = require('./prisma');
const { conIva } = require('./iva');
const { PRECIOS_NETOS_WEB } = require('./preciosWeb');

// "2026-10-22" -> mediodía de Chile, para que ningún cambio de huso mueva el día.
// Errores de datos de entrada: el panel los muestra tal cual (status 400).
function errorDeDatos(mensaje) {
  return Object.assign(new Error(mensaje), { status: 400 });
}

function fechaChile(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) throw errorDeDatos(`Fecha inválida: ${texto} (usar AAAA-MM-DD)`);
  return new Date(`${texto}T12:00:00-03:00`);
}

// Suma meses de calendario sin desbordar (31-ene + 1 mes -> 28/29-feb).
function sumarMeses(fecha, meses) {
  const r = new Date(fecha);
  const dia = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(dia, ultimo));
  return r;
}

// El cobro inicial combinado (plan + hosting del 1er año en un solo cobro) está APAGADO por defecto:
// el 2026-10-29 Flow rechazó cobros automáticos de $24.536 o más en nuestra cuenta (pasan $1.000 y
// $11.781). Encender con COBRO_INICIAL_WEB_ACTIVO=true cuando Flow suba el límite. Apagado, un link
// sin fecha de pago cobra solo el plan al registrar la tarjeta, como antes.
function cobroInicialWebActivo() {
  return process.env.COBRO_INICIAL_WEB_ACTIVO === 'true';
}

/**
 * @param {Object} p
 * @param {string} p.nombre
 * @param {string} p.email
 * @param {'MENSUAL'|'ANUAL'} p.plan
 * @param {string} [p.dominio]
 * @param {string} [p.pagadoEl] - AAAA-MM-DD: el primer período ya se pagó por fuera;
 *   Flow cobra por primera vez 1 mes (o 1 año) después. Sin esto, cobra al registrar la tarjeta.
 * @param {boolean} [p.sinHostingInicial] - solo aplica si COBRO_INICIAL_WEB_ACTIVO=true: sin pagadoEl se cobra
 *   al registrar la tarjeta el plan + el hosting del primer año (con la promo vigente). true = solo el plan
 *   (ej. hosting exento o pactado aparte).
 * @returns {Promise<{suscripcionWeb: Object, link: string}>}
 */
async function crearLinkSuscripcionWeb({ nombre, email, plan, dominio, pagadoEl, sinHostingInicial }, cliente = prisma) {
  if (!nombre || !email || !['MENSUAL', 'ANUAL'].includes(plan)) throw errorDeDatos('Faltan nombre, email o un plan válido (MENSUAL o ANUAL).');
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL para armar el link.');

  let fechaInicioContrato = null;
  let fechaPrimerCobro = null;
  if (pagadoEl) {
    fechaInicioContrato = fechaChile(pagadoEl);
    fechaPrimerCobro = sumarMeses(fechaInicioContrato, plan === 'ANUAL' ? 12 : 1);
    if (fechaPrimerCobro <= new Date()) throw errorDeDatos('Con esa fecha de pago, el primer cobro ya habría pasado.');
  }

  const suscripcionWeb = await cliente.suscripcionWeb.create({
    data: {
      ref: crypto.randomBytes(12).toString('base64url'),
      nombreCliente: nombre,
      emailCliente: String(email).trim().toLowerCase(),
      dominio: dominio || null,
      plan,
      montoConIva: conIva(PRECIOS_NETOS_WEB[plan]),
      fechaPrimerCobro,
      fechaInicioContrato,
      hostingAlRegistrar: cobroInicialWebActivo() && !pagadoEl && !sinHostingInicial,
    },
  });
  return { suscripcionWeb, link: urlSuscripcionWeb(suscripcionWeb.ref) };
}

function urlSuscripcionWeb(ref) {
  return `${process.env.BACKEND_URL}/web/suscribir/${ref}`;
}

module.exports = { crearLinkSuscripcionWeb, urlSuscripcionWeb, sumarMeses, fechaChile };
