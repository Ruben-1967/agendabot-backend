#!/usr/bin/env node
/**
 * Corrige cómo el bot de Multidigital dice el precio del sitio en Chile (pedido de Rubén del 02-nov).
 * Con "12 cuotas de $9.900 + IVA" el bot respondía "cuesta 12 cuotas de $9.900 + IVA al mes", que
 * suena raro. Ahora se dice "$9.900 + IVA al mes, y a la cuota 12 el sitio es tuyo". De paso
 * cambia "el sitio es suyo" por "tuyo" (el bot tutea).
 *
 * Requiere _cuotas-y-asistente-multidigital-01nov.js ya aplicado. Reemplaza frases exactas; si alguna
 * no calza, se detiene sin guardar nada. Imprime el texto anterior para poder volver atrás.
 * DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_precio-cuota-12-multidigital-02nov.js
 *   APLICAR=1 node scripts/_precio-cuota-12-multidigital-02nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'a la cuota 12 el sitio es';

const CAMBIOS_GUION = [
  [
    'En Chile, <precio mensual> se dice así: "12 cuotas de $9.900 + IVA al mes, y al completarlas el sitio es tuyo"',
    'En Chile, <precio mensual> se dice así: "$9.900 + IVA al mes, y a la cuota 12 el sitio es tuyo" (nunca "cuesta 12 cuotas de…")',
  ],
  [
    'cuesta 12 cuotas de $9.900 + IVA al mes (al completar las 12 cuotas el sitio es suyo), o $95.000 + IVA al año;',
    'cuesta $9.900 + IVA al mes, y a la cuota 12 el sitio es tuyo, o $95.000 + IVA al año;',
  ],
];

const CAMBIOS_INFO = [
  [
    'Valor: 12 cuotas de $9.900 + IVA al mes (al completar las 12 cuotas el sitio es del cliente), o pago anual',
    'Valor: $9.900 + IVA al mes, y a la cuota 12 el sitio es del cliente, o pago anual',
  ],
];

function reemplazar(texto, antes, despues, donde) {
  const veces = texto.split(antes).length - 1;
  if (veces !== 1) throw new Error(`En ${donde} la frase aparece ${veces} veces (se esperaba 1): "${antes.slice(0, 70)}…"`);
  return texto.replace(antes, () => despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  if ((e.guionAtencion || '').includes(MARCA)) {
    console.log('El precio con "a la cuota 12" ya está aplicado. No hay nada que hacer.');
    return;
  }
  let guion = e.guionAtencion || '';
  for (const [antes, despues] of CAMBIOS_GUION) guion = reemplazar(guion, antes, despues, 'el guion');
  let info = e.informacionAdicional || '';
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');

  const quedan = (guion + info).split('12 cuotas').length - 1;
  console.log(`Empresa: ${e.nombre}\n\n=== GUION NUEVO ===\n${guion}\n\n=== INFORMACIÓN NUEVA ===\n${info}\n`);
  console.log(`Menciones de "12 cuotas" que quedan: ${quedan}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_precio-cuota-12-multidigital-02nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
