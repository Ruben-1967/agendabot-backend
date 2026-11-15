#!/usr/bin/env node
/**
 * Nuevo orden del texto de precio en la apertura de Chile del bot de Multidigital
 * (pedido de Rubén, 2026-11-15): primero lo que incluye y después el precio, en
 * "primera cuota + 11 mensualidades (todo más IVA)". La mantención ya no se menciona
 * en la apertura (queda en el contrato V7 y en el punto 4 si preguntan).
 * Reemplaza frases exactas del guion; si alguna no calza, no guarda nada y muestra el texto
 * actual. Imprime el texto anterior como respaldo. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_apertura-11-mensualidades-multidigital-15nov.js
 *   APLICAR=1 node scripts/_apertura-11-mensualidades-multidigital-15nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = '11 mensualidades de $9.900';

const CAMBIOS = [
  ['precio de la apertura',
    'Tu sitio web profesional parte con una primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos con tu dominio, el hosting y tu dominio .cl por el primer año. Después son $9.900 + IVA al mes, que incluye la mantención de tu sitio.',
    'Tu sitio web profesional con todo lo necesario para partir: sitio web, hosting por un año, dominio .cl por un año y correos profesionales. Parte con una primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA).'],
  ['regla de la cuota 12',
    ' Nunca digas "11 cuotas" ni des a entender que después de la cuota 12 no se paga: la mensualidad es la mantención y sigue mientras tenga el servicio.',
    ' Si pregunta qué pasa después de la cuota 12, respóndele con lo del punto 4 (el sitio es suyo y la mantención sigue mientras mantenga el servicio).'],
];

function contar(texto, frase) { return texto.split(frase).length - 1; }

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital: no se hace nada.');
  let guion = e.guionAtencion || '';
  if (guion.includes(MARCA)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  for (const [nombre, antes, despues] of CAMBIOS) {
    const n = contar(guion, antes);
    console.log(`${nombre}: ${n} coincidencia(s)`);
    if (n !== 1) { errores.push(`${nombre}: se esperaba 1 y hay ${n}`); continue; }
    guion = guion.split(antes).join(despues);
  }
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('En Chile, la apertura del caso b');
  console.log(`\n=== APERTURA DE CHILE (nueva) ===\n${guion.slice(i, guion.indexOf('\n2. Datos a pedir'))}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_apertura-11-mensualidades-multidigital-15nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
