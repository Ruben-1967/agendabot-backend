#!/usr/bin/env node
/**
 * Crea el link de suscripción de un cliente de Multidigital (sitio web +
 * correos), ver src/routes/suscripcionWeb.js. Imprime el link para enviárselo.
 * Lo mismo se puede hacer desde el panel: Panel de Vendedores -> Clientes Web.
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
const prisma = require('../src/lib/prisma');
const { crearLinkSuscripcionWeb, sumarMeses } = require('../src/lib/linkSuscripcionWeb');

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const plan = String(args.plan || '').toUpperCase();
  const { suscripcionWeb: sw, link } = await crearLinkSuscripcionWeb({
    nombre: args.nombre, email: args.email, plan, dominio: args.dominio, pagadoEl: args['pagado-el'],
  });

  const fmt = (f) => f.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
  console.log(`\nCliente: ${sw.nombreCliente} (${sw.emailCliente})`);
  console.log(`Plan ${plan}: $${sw.montoConIva.toLocaleString('es-CL')} IVA incluido`);
  console.log(sw.fechaPrimerCobro
    ? `Primer cargo automático: ${fmt(sw.fechaPrimerCobro)} · Hosting desde: ${fmt(sumarMeses(sw.fechaInicioContrato, 12))}`
    : 'Primer cargo: al registrar la tarjeta');
  console.log(`\nLink: ${link}\n`);
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
