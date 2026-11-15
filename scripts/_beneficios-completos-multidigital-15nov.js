#!/usr/bin/env node
/**
 * Bot de Multidigital (Chile): la lista de beneficios de la apertura y del punto 4 suma lo que ya
 * dice multidigital.cl/sitio-web: registro en Google y ficha de Google Maps, botón de WhatsApp,
 * certificado de seguridad (https) y hasta 3 cambios menores al mes (pedido de Rubén, 2026-11-15).
 * Frases exactas; si alguna no calza, no guarda nada y muestra el texto actual.
 * Imprime el texto anterior como respaldo. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_beneficios-completos-multidigital-15nov.js
 *   APLICAR=1 node scripts/_beneficios-completos-multidigital-15nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = '✅ Hasta 3 cambios menores al mes';

const CAMBIOS = [
  ['lista de la apertura',
    '✅ Correos profesionales con tu dominio\n',
    `✅ Correos profesionales con tu dominio
✅ Registro en Google y ficha de Google Maps
✅ Botón de WhatsApp
✅ Certificado de seguridad (https)
${MARCA}
`],
  ['beneficios del punto 4',
    'y 2 correos profesionales con su dominio. Al final, el precio:',
    '2 correos profesionales con su dominio, registro en Google y ficha de Google Maps, botón de WhatsApp, certificado de seguridad (https) y hasta 3 cambios menores al mes. Al final, el precio:'],
];

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital: no se hace nada.');
  let guion = e.guionAtencion || '';
  if (guion.includes(MARCA)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  for (const [nombre, antes, despues] of CAMBIOS) {
    const n = guion.split(antes).length - 1;
    console.log(`${nombre}: ${n} coincidencia(s)`);
    if (n !== 1) { errores.push(`${nombre}: se esperaba 1 y hay ${n}`); continue; }
    guion = guion.split(antes).join(despues);
  }
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('Tu sitio web profesional incluye');
  console.log(`\n=== APERTURA (lista nueva) ===\n${guion.slice(i, guion.indexOf('Para prepararte', i))}`);
  const j = guion.indexOf('4. Si pregunta el precio');
  console.log(`=== PUNTO 4 (inicio) ===\n${guion.slice(j, guion.indexOf('REGLA', j))}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_beneficios-completos-multidigital-15nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
