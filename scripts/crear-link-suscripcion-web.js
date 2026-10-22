#!/usr/bin/env node
/**
 * Crea el link de suscripción de un cliente de Multidigital (sitio web +
 * correos), ver src/routes/suscripcionWeb.js. Imprime el link para enviárselo.
 *
 * Uso:
 *   node scripts/crear-link-suscripcion-web.js --nombre "Nexia Prevención" --email jose@ejemplo.cl \
 *        --plan MENSUAL [--dominio nexiaprevencion.cl] [--pagado-el 2026-10-22]
 *
 *   --plan       MENSUAL ($9.900 + IVA/mes) o ANUAL ($95.000 + IVA/año)
 *   --pagado-el  fecha en que pagó el primer período por fuera (transferencia).
 *                Flow cobra por primera vez 1 mes (o 1 año) después, y esa
 *                fecha es la base del aniversario del hosting.
 *                Sin esta opción, Flow cobra el primer período apenas el
 *                cliente registra su tarjeta.
 */

require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { conIva } = require('../src/lib/iva');
const { PRECIOS_NETOS_WEB: PRECIOS_NETOS } = require('../src/lib/preciosWeb');

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// "2026-10-22" -> mediodía de Chile, para que ningún cambio de huso mueva el día.
function fechaChile(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new Error(`Fecha inválida: ${texto} (usar AAAA-MM-DD)`);
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

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const plan = String(args.plan || '').toUpperCase();
  if (!args.nombre || !args.email || !PRECIOS_NETOS[plan]) {
    console.error('Uso: --nombre "..." --email ... --plan MENSUAL|ANUAL [--dominio ...] [--pagado-el AAAA-MM-DD]');
    process.exit(1);
  }
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL para armar el link.');

  let fechaInicioContrato = null;
  let fechaPrimerCobro = null;
  if (args['pagado-el']) {
    fechaInicioContrato = fechaChile(args['pagado-el']);
    fechaPrimerCobro = sumarMeses(fechaInicioContrato, plan === 'ANUAL' ? 12 : 1);
    if (fechaPrimerCobro <= new Date()) throw new Error('Con esa fecha de pago, el primer cobro ya habría pasado. Revisa --pagado-el.');
  }

  const sw = await prisma.suscripcionWeb.create({
    data: {
      ref: crypto.randomBytes(12).toString('base64url'),
      nombreCliente: args.nombre,
      emailCliente: String(args.email).trim().toLowerCase(),
      dominio: args.dominio || null,
      plan,
      montoConIva: conIva(PRECIOS_NETOS[plan]),
      fechaPrimerCobro,
      fechaInicioContrato,
    },
  });

  const fmt = (f) => f.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
  console.log(`\nCliente: ${sw.nombreCliente} (${sw.emailCliente})`);
  console.log(`Plan ${plan}: $${sw.montoConIva.toLocaleString('es-CL')} IVA incluido`);
  console.log(fechaPrimerCobro
    ? `Primer cargo automático: ${fmt(fechaPrimerCobro)} · Hosting desde: ${fmt(sumarMeses(fechaInicioContrato, 12))}`
    : 'Primer cargo: al registrar la tarjeta');
  console.log(`\nLink: ${process.env.BACKEND_URL}/web/suscribir/${sw.ref}\n`);
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
