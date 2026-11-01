#!/usr/bin/env node
/**
 * Dos correcciones a las respuestas del bot de Multidigital (pedido de Rubén del 01-nov),
 * vistas en conversaciones reales que llegaron por el anuncio "sitio web + Asistente 24/7":
 *   1) El "Asistente 24/7" del anuncio es el asistente para el sitio web, no TotemSystem:
 *      el bot respondía "desde $14.900 + IVA al mes" (precio de TotemSystem). Ahora vale
 *      $5.000 + IVA al mes adicional a los $9.900 (en total $14.900 + IVA, lo del anuncio).
 *   2) El precio del sitio se dice "12 cuotas de $9.900 + IVA", para que quede claro que al
 *      completarlas el sitio es del cliente (contrato V6).
 * Todas las frases nuevas llevan "$", así que para Perú, Colombia y México se quitan solas
 * (guionSinPrecios / informacionSinPrecios en claude.js) y allá no se ofrece nada de esto.
 *
 * Requiere la oferta de noviembre ya aplicada (_oferta-noviembre-multidigital-30oct.js).
 * Reemplaza frases exactas; si alguna no calza, se detiene sin guardar nada. Imprime el
 * texto anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_cuotas-y-asistente-multidigital-01nov.js
 *   APLICAR=1 node scripts/_cuotas-y-asistente-multidigital-01nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = '12 cuotas de $9.900';

const ANCLA_APERTURA = 'El hosting siempre con verbo (ej. "El hosting cuesta S/ 149 al año"), nunca solo el monto.';

const CAMBIOS_GUION = [
  [
    ANCLA_APERTURA,
    `${ANCLA_APERTURA}
   En Chile, <precio mensual> se dice así: "12 cuotas de $9.900 + IVA al mes, y al completarlas el sitio es tuyo" (si pregunta por el pago anual: $95.000 + IVA al año).
   Si el mensaje menciona el "Asistente 24/7" (viene del anuncio del sitio web con asistente), se refiere al asistente para el sitio web, NO a TotemSystem: al final del primer párrafo agrega "El asistente 24/7 para tu sitio web tiene un valor de $5.000 + IVA al mes adicional, en total $14.900 + IVA al mes." No menciones TotemSystem salvo que pregunte por un asistente de WhatsApp.`,
  ],
  [
    'el sitio web de una página + 2 correos corporativos cuesta $9.900 + IVA al mes, o $95.000 + IVA al año; sin permanencia.',
    'el sitio web de una página + 2 correos corporativos cuesta 12 cuotas de $9.900 + IVA al mes (al completar las 12 cuotas el sitio es suyo), o $95.000 + IVA al año; sin permanencia. El asistente 24/7 para el sitio web es adicional: $5.000 + IVA al mes.',
  ],
];

const CAMBIOS_INFO = [
  [
    'Valor: $9.900 al mes + IVA, o pago anual',
    'Valor: 12 cuotas de $9.900 + IVA al mes (al completar las 12 cuotas el sitio es del cliente), o pago anual',
  ],
  [
    'Asistente: $4.990 + IVA al mes, hasta 150 conversaciones al mes.',
    'En los anuncios se llama "Asistente 24/7": quien pide información del "sitio web + Asistente 24/7" se refiere a este asistente del sitio web, no a TotemSystem. Asistente: $5.000 + IVA al mes adicional al sitio web (sitio + asistente: $14.900 + IVA al mes), hasta 150 conversaciones al mes.',
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
    console.log('Las cuotas y el asistente ya están aplicados. No hay nada que hacer.');
    return;
  }
  if (!(e.informacionAdicional || '').includes('Asistente para el sitio web')) {
    throw new Error('Falta la oferta de noviembre: corre primero scripts/_oferta-noviembre-multidigital-30oct.js');
  }
  let guion = e.guionAtencion || '';
  for (const [antes, despues] of CAMBIOS_GUION) guion = reemplazar(guion, antes, despues, 'el guion');
  let info = e.informacionAdicional || '';
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');

  console.log(`Empresa: ${e.nombre}\n\n=== GUION NUEVO ===\n${guion}\n\n=== INFORMACIÓN NUEVA ===\n${info}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_cuotas-y-asistente-multidigital-01nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
