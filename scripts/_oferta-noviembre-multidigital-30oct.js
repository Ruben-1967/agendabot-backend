#!/usr/bin/env node
/**
 * Oferta de noviembre 2026 en el bot de Multidigital (decisiones de Rubén del 30-oct):
 *   - Hosting: 50% de descuento el 1er año hasta el 31-oct, 20% del 1 al 30 de noviembre,
 *     1 UF + IVA desde diciembre. Van los tres tramos: el bot recibe la fecha de Chile y no
 *     ofrece promociones vencidas, así que este script se puede aplicar antes del 1-nov.
 *   - Presencia en Google incluida (registro del sitio y ficha de Google Maps).
 *   - A las 12 mensualidades el sitio es del cliente (contrato V6).
 *   - Asistente para el sitio web (adicional, solo con el sitio y por ahora solo en Chile).
 *
 * Reemplaza frases exactas del guion y de la información; si alguna no calza (alguien las
 * cambió a mano), se detiene sin guardar nada. Imprime el texto anterior para poder volver
 * atrás. DRY-RUN por defecto. Las frases con precios chilenos se quitan solas para Perú,
 * Colombia y México (guionSinPrecios / informacionSinPrecios en claude.js).
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_oferta-noviembre-multidigital-30oct.js
 *   APLICAR=1 node scripts/_oferta-noviembre-multidigital-30oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

const HOSTING_ANTES_GUION = 'Hosting: contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA), a contar del segundo año en adelante 1 UF + IVA al año. Luego retoma el guion.';
const HOSTING_DESPUES_GUION = 'Hosting: 1 UF + IVA al año; contratando hasta el 31 de octubre de 2026 el primer año tiene 50% de descuento (0,5 UF + IVA), y contratando del 1 al 30 de noviembre de 2026, 20% de descuento (0,8 UF + IVA). Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps). Luego retoma el guion.';

const CAMBIOS_INFO = [
  [
    'Hosting: contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA), a contar del segundo año en adelante 1 UF + IVA al año. Quien contrate desde el 1 de noviembre de 2026 paga 1 UF + IVA desde el primer año.',
    'Hosting: 1 UF + IVA al año. Contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA). Contratando del 1 al 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA). Quien contrate desde el 1 de diciembre de 2026 paga 1 UF + IVA desde el primer año. Incluye sin costo la presencia en Google: registramos el sitio en Google y creamos la ficha de Google Maps del negocio.',
  ],
  [
    'si se va, el sitio deja de publicarse, pero el hosting y los correos siguen activos hasta completar 1 año desde la contratación.',
    'si se va antes de completar 12 mensualidades, el sitio deja de publicarse, pero el hosting y los correos siguen activos hasta completar 1 año desde la contratación. Al completar 12 mensualidades, el sitio es del cliente: tiene derecho a pedir todos los archivos de su sitio web.',
  ],
  [
    '- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.',
    `- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.
- Asistente para el sitio web (adicional, solo junto al sitio web y por ahora solo en Chile): un chat en el sitio que responde solo, a cualquier hora, las preguntas de los clientes con la información del negocio, y deja anotados los datos de los interesados para contactarlos. Asistente: $4.990 + IVA al mes, hasta 150 conversaciones al mes. Asistente Pro: $9.990 + IVA al mes, hasta 400 conversaciones al mes, con recargas de 300 conversaciones por $3.990 + IVA si se acaban. Si el cliente paga el sitio anual, el asistente también se puede pagar anual con 20% de descuento.`,
  ],
  [
    'Solo el sitio web + correos y TotemSystem tienen precio indicado aquí.',
    'Solo el sitio web + correos, el asistente para el sitio web y TotemSystem tienen precio indicado aquí.',
  ],
];

function reemplazar(texto, antes, despues, donde) {
  const veces = texto.split(antes).length - 1;
  if (veces !== 1) throw new Error(`En ${donde} la frase aparece ${veces} veces (se esperaba 1): "${antes.slice(0, 70)}…"`);
  return texto.replace(antes, despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  if ((e.informacionAdicional || '').includes('Asistente para el sitio web')) {
    console.log('La oferta de noviembre ya está aplicada. No hay nada que hacer.');
    return;
  }
  const guion = reemplazar(e.guionAtencion || '', HOSTING_ANTES_GUION, HOSTING_DESPUES_GUION, 'el guion');
  let info = e.informacionAdicional || '';
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');

  console.log(`Empresa: ${e.nombre}\n\n=== GUION NUEVO ===\n${guion}\n\n=== INFORMACIÓN NUEVA ===\n${info}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_oferta-noviembre-multidigital-30oct.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
