#!/usr/bin/env node
/**
 * Bot de Multidigital (Chile): el precio parte por los $9.900 al mes del anuncio. Un prospecto se
 * molestó el 2026-11-15 ("dice una publicidad de nueve mil pesos y salen con cualquier plata") porque
 * el primer precio que veía era $49.900. Texto aprobado por Rubén:
 *   "Todo esto por $9.900 al mes. Al partir, la primera cuota es de $49.900 porque incluye el hosting
 *    y el dominio .cl por todo un año. Si ya tienes tu propio hosting y dominio, partes pagando solo
 *    los $9.900 (todo más IVA)."
 * Si tiene solo el dominio: $9.900 + IVA más el hosting del primer año (solo si pregunta).
 * Cambia la apertura, el punto 4 y el "Valor" de la información. Frases exactas; si alguna no calza,
 * no guarda nada y muestra el texto actual. Imprime el texto anterior como respaldo.
 * DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_precio-desde-9900-multidigital-15nov.js
 *   APLICAR=1 node scripts/_precio-desde-9900-multidigital-15nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const PRECIO = 'Todo esto por $9.900 al mes. Al partir, la primera cuota es de $49.900 porque incluye el hosting y el dominio .cl por todo un año. Si ya tienes tu propio hosting y dominio, partes pagando solo los $9.900 (todo más IVA).';

const CAMBIOS_GUION = [
  ['precio de la apertura',
    'Todo esto parte con una primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA).',
    PRECIO],
  ['precio del punto 4',
    'Al final, el precio: primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA).',
    `Al final, el precio, partiendo siempre por la mensualidad (es el valor que muestran los anuncios): "${PRECIO}" Si tiene solo el dominio (sin hosting propio), la primera cuota es $9.900 + IVA más el hosting del primer año; dilo solo si lo pregunta. Si tiene hosting propio, el sitio se publica en su servidor y una persona del equipo lo coordina.`],
];
const CAMBIOS_INFO = [
  ['valor de la información',
    'y 2 correos profesionales, con una primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA).',
    'y 2 correos profesionales, por $9.900 + IVA al mes; al partir, la primera cuota es de $49.900 + IVA porque incluye el hosting y el dominio .cl del primer año. Con hosting y dominio propios, parte pagando solo $9.900 + IVA; con solo el dominio, $9.900 + IVA más el hosting del primer año.'],
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
  if ((e.guionAtencion || '').includes(PRECIO)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  const guion = aplicar(e.guionAtencion || '', CAMBIOS_GUION, errores);
  const info = aplicar(e.informacionAdicional || '', CAMBIOS_INFO, errores);
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n\n=== INFORMACIÓN ACTUAL ===\n${e.informacionAdicional}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('Tu sitio web profesional incluye');
  console.log(`\n=== APERTURA (nueva) ===\n${guion.slice(i, guion.indexOf('Para prepararte', i))}`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_precio-desde-9900-multidigital-15nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
