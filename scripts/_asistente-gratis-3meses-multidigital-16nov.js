#!/usr/bin/env node
/**
 * Bot de Multidigital (Chile), pedido de Rubén 2026-11-16: en la lista de beneficios del primer mensaje,
 * "✅ Hasta 3 cambios menores al mes" se reemplaza por "✅ Asistente de ventas con IA 24/7, gratis por 3 meses".
 * El bot también sabe qué es el asistente y que después de los 3 meses cuesta $4.990 + IVA al mes (o se da
 * de baja sin costo). Los 3 cambios menores siguen en el punto 4 (qué incluye / mantención) y en el contrato.
 * Frases exactas; si alguna no calza, no guarda nada y muestra el texto actual.
 * Imprime el texto anterior como respaldo. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_asistente-gratis-3meses-multidigital-16nov.js
 *   APLICAR=1 node scripts/_asistente-gratis-3meses-multidigital-16nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const LINEA = '✅ Asistente de ventas con IA 24/7, gratis por 3 meses';
const EXPLICA = 'El asistente de ventas con IA 24/7 es un chat en tu sitio web que responde solo, a cualquier hora, las preguntas de tus clientes con la información de tu negocio, y te avisa cuando alguien quiere cotizar o comprar. Es gratis los 3 primeros meses; después cuesta $4.990 + IVA al mes, y si no lo quieres seguir usando lo das de baja sin costo.';

const CAMBIOS_GUION = [
  ['lista del primer mensaje',
    '✅ Hasta 3 cambios menores al mes\n',
    `${LINEA}\n`],
  ['asistente en la apertura (anuncio)',
    'al final del párrafo del precio agrega "El asistente 24/7 para tu sitio web tiene un valor de $4.990 + IVA al mes adicional, en total $14.890 + IVA al mes."',
    `responde con el mismo mensaje de la apertura (ya incluye el asistente gratis por 3 meses) y, si pregunta qué es o cuánto cuesta después, explícale: "${EXPLICA}"`],
  ['beneficios del punto 4',
    'certificado de seguridad (https) y hasta 3 cambios menores al mes. Al final, el precio',
    'certificado de seguridad (https), hasta 3 cambios menores al mes y un asistente de ventas con IA 24/7 gratis por 3 meses. Al final, el precio'],
  ['precio del asistente en el punto 4',
    'El asistente 24/7 para el sitio web es adicional: $4.990 + IVA al mes.',
    `Asistente de ventas con IA 24/7: ${EXPLICA} Nunca digas que es gratis para siempre.`],
];
const CAMBIOS_INFO = [
  ['asistente en la información',
    'Asistente: $4.990 + IVA al mes adicional al sitio web (sitio + asistente: $14.890 + IVA al mes), hasta 150 conversaciones al mes.',
    'Asistente: gratis los 3 primeros meses al contratar el sitio web; después $4.990 + IVA al mes adicional (sitio + asistente: $14.890 + IVA al mes), y el cliente lo puede dar de baja sin costo. Hasta 150 conversaciones al mes.'],
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
  if ((e.guionAtencion || '').includes(LINEA)) return console.log('Ya está aplicado. No hay nada que hacer.');
  const errores = [];
  const guion = aplicar(e.guionAtencion || '', CAMBIOS_GUION, errores);
  const info = aplicar(e.informacionAdicional || '', CAMBIOS_INFO, errores);
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${e.guionAtencion}\n\n=== INFORMACIÓN ACTUAL ===\n${e.informacionAdicional}\n`);
    throw new Error(`No se guardó nada.\n- ${errores.join('\n- ')}`);
  }
  const i = guion.indexOf('Tu sitio web profesional incluye');
  console.log(`\n=== PRIMER MENSAJE (lista nueva) ===\n${guion.slice(i, guion.indexOf('Para prepararte', i))}`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_asistente-gratis-3meses-multidigital-16nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
