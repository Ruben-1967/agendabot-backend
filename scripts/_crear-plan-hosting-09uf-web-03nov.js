#!/usr/bin/env node
/**
 * Crea en Flow el plan del hosting anual de la suscripción web a 0,9 UF + IVA (afiches de
 * noviembre, decisión de Rubén del 03-nov). El plan de 22-oct (multidigital-web-hosting) quedó
 * a 1 UF ($49.028) y el monto de un plan de Flow no se puede editar: hay que crear otro.
 *
 * Solo crea el plan (no cobra nada ni toca suscripciones). Imprime el planId: después hay que
 * cambiar FLOW_PLAN_ID_WEB_HOSTING en Render por ese valor y redesplegar. Las suscripciones
 * que ya existen siguen en el plan anterior; solo las nuevas toman este.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_crear-plan-hosting-09uf-web-03nov.js
 *   APLICAR=1 node scripts/_crear-plan-hosting-09uf-web-03nov.js
 */

require('dotenv').config();
const { crearPlanFlow } = require('../src/services/flowClient');
const { obtenerValorUfHoy } = require('../src/lib/uf');
const { conIva } = require('../src/lib/iva');
const { UF_HOSTING_WEB } = require('../src/lib/preciosWeb');

const PLAN_ID = 'multidigital-web-hosting-09uf';

async function main() {
  if (process.env.FLOW_PLAN_ID_WEB_HOSTING === PLAN_ID) {
    console.log(`FLOW_PLAN_ID_WEB_HOSTING ya es ${PLAN_ID}. No hay nada que hacer.`);
    return;
  }
  if (!process.env.BACKEND_URL) throw new Error('Falta BACKEND_URL (se usa para el urlCallback del plan).');
  const urlCallback = `${process.env.BACKEND_URL}/web/flow-webhook`;
  const valorUf = await obtenerValorUfHoy();
  const montoClp = conIva(valorUf * UF_HOSTING_WEB);

  console.log(`Flow: ${process.env.FLOW_ENDPOINT || 'https://api.flow.cl/api (PRODUCCIÓN)'}`);
  console.log(`urlCallback: ${urlCallback}`);
  console.log(`Plan actual (FLOW_PLAN_ID_WEB_HOSTING): ${process.env.FLOW_PLAN_ID_WEB_HOSTING || '(vacío)'}`);
  console.log(`Plan nuevo: ${PLAN_ID}, ${UF_HOSTING_WEB} UF + IVA con UF $${valorUf.toLocaleString('es-CL')} = $${montoClp.toLocaleString('es-CL')} al año\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se creó nada. Para crearlo: APLICAR=1 node scripts/_crear-plan-hosting-09uf-web-03nov.js');
    return;
  }
  const plan = await crearPlanFlow({ planId: PLAN_ID, nombre: `Multidigital Hosting anual (${UF_HOSTING_WEB} UF)`, montoClp, interval: 4, urlCallback });
  console.log(`✅ Plan creado. Ahora en Render: FLOW_PLAN_ID_WEB_HOSTING=${plan.planId} y redesplegar.`);
}

main().catch((err) => { console.error('❌', err.message); process.exitCode = 1; });
