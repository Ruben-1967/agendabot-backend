#!/usr/bin/env node
/**
 * Crea (una sola vez) los 4 Planes de suscripción en Flow.cl: Plan A, B, C
 * (mensuales) y Hosting (anual, 1 UF). Necesario antes de que cualquier
 * cliente pueda suscribirse — Flow exige que el Plan exista antes de poder
 * asociarle una Suscripción.
 *
 * Imprime los 4 planId resultantes — hay que guardarlos en Render como
 * FLOW_PLAN_ID_A / FLOW_PLAN_ID_B / FLOW_PLAN_ID_C / FLOW_PLAN_ID_HOSTING.
 *
 * Si se vuelve a correr con las mismas variables ya seteadas, avisa y no
 * hace nada — evita crear planes duplicados en Flow por error.
 *
 * Uso (Render Shell, con las credenciales reales de Flow en el entorno):
 *   node scripts/crear-planes-flow.js
 */

require('dotenv').config();
const { crearPlanFlow } = require('../src/services/flowClient');
const { PLANES: DETALLE_PLANES } = require('../src/services/contratoHtml');
const { obtenerValorUfHoy } = require('../src/lib/uf');

const YA_CONFIGURADOS = ['FLOW_PLAN_ID_A', 'FLOW_PLAN_ID_B', 'FLOW_PLAN_ID_C', 'FLOW_PLAN_ID_HOSTING']
  .filter((v) => process.env[v]);

async function main() {
  if (YA_CONFIGURADOS.length > 0) {
    console.error(`\n⚠️  Ya hay variables de plan configuradas en el entorno: ${YA_CONFIGURADOS.join(', ')}`);
    console.error('Si de verdad querés crear planes nuevos (ej. cambiaron los precios), borrá esas variables');
    console.error('de Render primero — si no, corriendo este script de nuevo vas a duplicar los planes en Flow.\n');
    process.exit(1);
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.error('Falta BACKEND_URL en el entorno (necesario para armar urlCallback).');
    process.exit(1);
  }
  const urlCallback = `${backendUrl}/suscripcion/flow-webhook-plan`;

  const valorUf = await obtenerValorUfHoy();
  console.log(`\nValor UF de hoy: $${valorUf.toLocaleString('es-CL')} CLP\n`);

  const resultados = {};

  for (const [planEnum, detalle] of Object.entries(DETALLE_PLANES)) {
    const letra = planEnum.replace('PLAN_', ''); // PLAN_A -> A
    console.log(`Creando ${planEnum} ($${detalle.montoMensual}/mes)...`);
    const plan = await crearPlanFlow({
      planId: `agendabot-plan-${letra.toLowerCase()}`,
      nombre: `AgendaBot ${detalle.etiqueta}`,
      montoClp: detalle.montoMensual,
      interval: 3, // mensual
      urlCallback,
    });
    resultados[`FLOW_PLAN_ID_${letra}`] = plan.planId;
    console.log(`  -> planId: ${plan.planId}`);
  }

  console.log(`\nCreando plan de Hosting anual (1 UF ≈ $${valorUf.toLocaleString('es-CL')})...`);
  const planHosting = await crearPlanFlow({
    planId: 'agendabot-hosting-anual',
    nombre: 'AgendaBot Hosting anual (1 UF)',
    montoClp: valorUf,
    interval: 4, // anual
    urlCallback,
  });
  resultados.FLOW_PLAN_ID_HOSTING = planHosting.planId;
  console.log(`  -> planId: ${planHosting.planId}`);

  console.log('\n✅ Planes creados. Guardá esto en las variables de entorno de Render:\n');
  for (const [nombreVar, planId] of Object.entries(resultados)) {
    console.log(`${nombreVar}=${planId}`);
  }
  console.log('\nNota: el monto del plan de Hosting queda fijo en el CLP de hoy — para que se mantenga');
  console.log('cerca de 1 UF real con el paso de los años hace falta un cron que lo actualice una vez al');
  console.log('año vía /plans/edit (pendiente, fuera de esta primera integración).\n');
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
