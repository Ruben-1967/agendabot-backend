#!/usr/bin/env node
/**
 * Crea (una sola vez por ambiente) los 3 Planes de Flow de la suscripción web
 * de Multidigital (sitio web + correos), ver src/routes/suscripcionWeb.js:
 *   - multidigital-web-mensual: $9.900 + IVA al mes
 *   - multidigital-web-anual:   $95.000 + IVA al año
 *   - multidigital-web-hosting: 1 UF + IVA al año (valor de la UF del día en que se crea)
 * Su urlCallback es /web/flow-webhook, NO el de TotemSystem.
 *
 * Imprime los planId: guardarlos en Render como FLOW_PLAN_ID_WEB_MENSUAL,
 * FLOW_PLAN_ID_WEB_ANUAL y FLOW_PLAN_ID_WEB_HOSTING. Si ya están seteadas,
 * no hace nada (evita duplicar planes en Flow).
 *
 * Uso (Shell de Render, o local con el .env del ambiente que corresponda):
 *   node scripts/crear-planes-flow-web.js
 */

require('dotenv').config();
const { crearPlanFlow } = require('../src/services/flowClient');
const { obtenerValorUfHoy } = require('../src/lib/uf');
const { conIva } = require('../src/lib/iva');
const { PRECIOS_NETOS_WEB } = require('../src/lib/preciosWeb');

const VARIABLES = ['FLOW_PLAN_ID_WEB_MENSUAL', 'FLOW_PLAN_ID_WEB_ANUAL', 'FLOW_PLAN_ID_WEB_HOSTING'];

async function main() {
  const yaConfiguradas = VARIABLES.filter((v) => process.env[v]);
  if (yaConfiguradas.length > 0) {
    console.error(`Ya están configuradas: ${yaConfiguradas.join(', ')}. No se crea nada (evita duplicar planes en Flow).`);
    process.exit(1);
  }
  if (!process.env.BACKEND_URL) {
    console.error('Falta BACKEND_URL (se usa para el urlCallback de los planes).');
    process.exit(1);
  }
  const urlCallback = `${process.env.BACKEND_URL}/web/flow-webhook`;
  console.log(`Flow: ${process.env.FLOW_ENDPOINT || 'https://api.flow.cl/api (PRODUCCIÓN)'}`);
  console.log(`urlCallback: ${urlCallback}\n`);

  const valorUf = await obtenerValorUfHoy();
  const planes = [
    { variable: 'FLOW_PLAN_ID_WEB_MENSUAL', planId: 'multidigital-web-mensual', nombre: 'Multidigital Sitio web + correos (mensual)', montoClp: conIva(PRECIOS_NETOS_WEB.MENSUAL), interval: 3 },
    { variable: 'FLOW_PLAN_ID_WEB_ANUAL', planId: 'multidigital-web-anual', nombre: 'Multidigital Sitio web + correos (anual)', montoClp: conIva(PRECIOS_NETOS_WEB.ANUAL), interval: 4 },
    { variable: 'FLOW_PLAN_ID_WEB_HOSTING', planId: 'multidigital-web-hosting', nombre: 'Multidigital Hosting anual (1 UF)', montoClp: conIva(valorUf), interval: 4 },
  ];

  for (const p of planes) {
    const plan = await crearPlanFlow({ planId: p.planId, nombre: p.nombre, montoClp: p.montoClp, interval: p.interval, urlCallback });
    console.log(`${p.variable}=${plan.planId}   ($${p.montoClp.toLocaleString('es-CL')} ${p.interval === 3 ? 'mensual' : 'anual'})`);
  }
  console.log(`\nUF usada para el hosting: $${valorUf.toLocaleString('es-CL')}. Guardar las 3 variables en Render y redesplegar.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
