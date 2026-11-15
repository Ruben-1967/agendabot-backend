#!/usr/bin/env node
/**
 * Bot de Multidigital (Chile): cuando el prospecto llega del anuncio preguntando "¿Qué incluye el plan
 * de $9.900 + IVA?", el bot respondía partiendo por la mensualidad y la mantención y enumeraba lo que
 * NO incluye (visto por Rubén el 2026-11-15). Desde ahora esa pregunta se responde con el mismo mensaje
 * de apertura (beneficios primero y el precio al final), y lo que no incluye la mantención solo se dice
 * si lo preguntan.
 * Frases exactas; si alguna no calza, no guarda nada y muestra el texto actual.
 * Imprime el texto anterior como respaldo. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_pregunta-plan-9900-multidigital-15nov.js
 *   APLICAR=1 node scripts/_pregunta-plan-9900-multidigital-15nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'qué incluye el plan de $9.900';

const CAMBIOS_GUION = [
  ['apertura: pregunta del anuncio',
    ' Si en su primer mensaje ya dio alguno de esos datos, pide solo los que falten.',
    ' Usa este mismo mensaje cuando pregunte "¿qué incluye el plan de $9.900 + IVA?" o algo parecido (viene del anuncio): los $9.900 son las mensualidades del sitio, así que responde con la lista de lo que incluye y al final el precio, sin partir por la mensualidad ni por la mantención. Si en su primer mensaje ya dio alguno de esos datos, pide solo los que falten.'],
];
const CAMBIOS_INFO = [
  ['información: lo que no incluye',
    'La mantención no incluye cambios mayores, contenidos nuevos, publicidad ni la renovación anual del hosting y del dominio.',
    'La mantención no incluye cambios mayores, contenidos nuevos, publicidad ni la renovación anual del hosting y del dominio (dilo solo si preguntan qué no incluye).'],
];

function aplicar(texto, cambios, errores) {
  let t = texto;
  for (const [nombre, antes, despues] of cambios) {
    const n = t.split(antes).length - 1;
    console.log(`${nombre}: ${n} coincidencia(s)`);
    if (n !== 1) { errores.push(`${nombre}: se esperaba 1 y hay ${n}`); continue; }
    t = t.split(antes).join(despues);
  }
  return t;
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital: no se hace nada.');
  if ((e.guionAtencion || '').includes(MARCA)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  const guion = aplicar(e.guionAtencion || '', CAMBIOS_GUION, errores);
  const info = aplicar(e.informacionAdicional || '', CAMBIOS_INFO, errores);
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n\n=== INFORMACIÓN ACTUAL ===\n${e.informacionAdicional}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('Usa este mismo mensaje cuando pregunte');
  console.log(`\n=== NUEVO (guion) ===\n${guion.slice(i, guion.indexOf('Si en su primer mensaje', i))}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_pregunta-plan-9900-multidigital-15nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
