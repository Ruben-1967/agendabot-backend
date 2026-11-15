#!/usr/bin/env node
/**
 * Bot de Multidigital (Chile): al hablar del precio del sitio, primero los beneficios y al final
 * el precio (pedido de Rubén, 2026-11-15). Cambia la apertura (lista de beneficios), el punto 4
 * ("si pregunta el precio", que partía por la cuota) y el "Valor" de la información.
 * Frases exactas; si alguna no calza, no guarda nada y muestra el texto actual.
 * Imprime el texto anterior como respaldo. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_precio-beneficios-primero-multidigital-15nov.js
 *   APLICAR=1 node scripts/_precio-beneficios-primero-multidigital-15nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'beneficios primero y el precio al final';
const PRECIO = 'primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA)';

const CAMBIOS_GUION = [
  ['apertura',
    'Tu sitio web profesional con todo lo necesario para partir: sitio web, hosting por un año, dominio .cl por un año y correos profesionales. Parte con una primera cuota de $49.900 y luego 11 mensualidades de $9.900 (todo más IVA).',
    `Tu sitio web profesional incluye todo lo necesario para partir:
✅ Sitio web profesional
✅ Hosting por un año
✅ Dominio .cl por un año
✅ Correos profesionales con tu dominio

Todo esto parte con una ${PRECIO}.`],
  ['punto 4',
    'tiene una primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos, el hosting y el dominio .cl por el primer año (el dominio queda inscrito a nombre del cliente). Después son $9.900 + IVA al mes, que incluye la mantención (',
    `incluye todo lo necesario para partir: sitio web profesional, hosting por un año, dominio .cl por un año (inscrito a nombre del cliente) y 2 correos profesionales con su dominio. Al final, el precio: ${PRECIO}. REGLA: cada vez que hables del precio del sitio, di primero lo que incluye (beneficios primero y el precio al final), nunca partas por el monto. La mensualidad incluye la mantención (`],
];
const CAMBIOS_INFO = [
  ['valor',
    'Valor (Chile, desde el 14-nov-2026): primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos, el hosting y el dominio .cl del primer año (inscrito a nombre del cliente). Después $9.900 + IVA al mes, que incluye la mantención:',
    `Valor (Chile, desde el 14-nov-2026): incluye el sitio web profesional, el hosting por un año, el dominio .cl por un año (inscrito a nombre del cliente) y 2 correos profesionales, con una ${PRECIO}. Al hablar del precio, siempre los beneficios primero y el precio al final. La mensualidad incluye la mantención:`],
];

function aplicar(texto, cambios, donde, errores) {
  let t = texto;
  for (const [nombre, antes, despues] of cambios) {
    const n = t.split(antes).length - 1;
    console.log(`${donde} · ${nombre}: ${n} coincidencia(s)`);
    if (n !== 1) { errores.push(`${donde} · ${nombre}: se esperaba 1 y hay ${n}`); continue; }
    t = t.split(antes).join(despues);
  }
  return t;
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital: no se hace nada.');
  if ((e.guionAtencion || '').includes(MARCA)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  const guion = aplicar(e.guionAtencion || '', CAMBIOS_GUION, 'guion', errores);
  const info = aplicar(e.informacionAdicional || '', CAMBIOS_INFO, 'información', errores);
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n\n=== INFORMACIÓN ACTUAL ===\n${e.informacionAdicional}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('En Chile, la apertura del caso b');
  console.log(`\n=== APERTURA DE CHILE (nueva) ===\n${guion.slice(i, guion.indexOf('Si en su primer mensaje'))}`);
  const j = guion.indexOf('4. Si pregunta el precio');
  console.log(`\n=== PUNTO 4 (inicio, nuevo) ===\n${guion.slice(j, guion.indexOf('A la cuota 12', j))}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_precio-beneficios-primero-multidigital-15nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
