#!/usr/bin/env node
/**
 * Precio comercial del Asistente para el sitio web (Asistente 24/7): $4.990 + IVA al mes
 * (decisión de Rubén del 10-nov). Antes: $5.000 + IVA. Sitio + asistente pasa de $14.900 a
 * $14.890 + IVA al mes. NO toca TotemSystem simple ($5.000), que es otro producto.
 *
 * Reemplaza frases exactas en guion e información; cada frase debe aparecer exactamente las
 * veces indicadas o se detiene sin guardar. Imprime el texto anterior para volver atrás.
 * DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_asistente-4990-multidigital-10nov.js
 *   APLICAR=1 node scripts/_asistente-4990-multidigital-10nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

// [antes, después] — se aplican en guion e información, donde aparezcan.
const CAMBIOS = [
  ['Asistente: $5.000 + IVA al mes adicional al sitio web (sitio + asistente: $14.900 + IVA al mes)',
    'Asistente: $4.990 + IVA al mes adicional al sitio web (sitio + asistente: $14.890 + IVA al mes)'],
  ['tiene un valor de $5.000 + IVA al mes adicional, en total $14.900 + IVA al mes',
    'tiene un valor de $4.990 + IVA al mes adicional, en total $14.890 + IVA al mes'],
];

function contar(texto, frase) { return texto.split(frase).length - 1; }

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  let guion = e.guionAtencion || '';
  let info = e.informacionAdicional || '';
  let total = 0;
  for (const [antes, despues] of CAMBIOS) {
    const n = contar(guion, antes) + contar(info, antes);
    console.log(`${n}× "${antes.slice(0, 70)}…"`);
    total += n;
    guion = guion.split(antes).join(despues);
    info = info.split(antes).join(despues);
  }
  if (total === 0) {
    if ((guion + info).includes('$4.990')) return console.log('Ya está aplicado. No hay nada que hacer.');
    throw new Error('Ninguna frase calzó: revisar el texto actual a mano.');
  }
  // Lo que quede con $5.000 debe ser solo TotemSystem simple.
  for (const [nombre, t] of [['guion', guion], ['información', info]]) {
    for (const m of t.matchAll(/[^.\n]*\$5\.000[^.\n]*/g)) console.log(`(queda $5.000 en ${nombre}: "${m[0].trim().slice(0, 120)}")`);
  }
  if (process.env.APLICAR !== '1') {
    console.log('\nDRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_asistente-4990-multidigital-10nov.js');
    return;
  }
  console.log(`\n=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
