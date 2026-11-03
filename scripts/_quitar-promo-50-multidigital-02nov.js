#!/usr/bin/env node
/**
 * Quita del bot de Multidigital la promo del hosting que ya terminó (50% el 1er año,
 * contratando hasta el 31-oct-2026) y deja solo la de noviembre: 20% el 1er año
 * (0,8 UF + IVA) contratando hasta el 30-nov-2026, luego 1 UF + IVA al año, con la
 * presencia en Google incluida (registro del sitio + ficha de Google Maps), sin
 * prometer el primer lugar en Google.
 *
 * Requiere _oferta-noviembre-multidigital-30oct.js ya aplicado (lo está desde el 01-nov):
 * reemplaza las frases exactas que dejó ese script en el guion y en la información. Si
 * alguna no calza (alguien las cambió a mano), se detiene sin guardar nada. Solo toca
 * guionAtencion e informacionAdicional de la Empresa Multidigital; no manda mensajes.
 * Imprime el antes y el después; al aplicar, imprime también el texto anterior completo
 * para poder volver atrás. DRY-RUN por defecto.
 *
 * Las frases con UF/IVA se quitan solas para Perú, Colombia y México (guionSinPrecios /
 * informacionSinPrecios en claude.js), igual que antes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_quitar-promo-50-multidigital-02nov.js
 *   APLICAR=1 node scripts/_quitar-promo-50-multidigital-02nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

const CAMBIOS_GUION = [
  [
    'contratando hasta el 31 de octubre de 2026 el primer año tiene 50% de descuento (0,5 UF + IVA), y contratando del 1 al 30 de noviembre de 2026, 20% de descuento (0,8 UF + IVA).',
    'contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA).',
  ],
  [
    'Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps).',
    'Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps); nunca prometas el primer lugar en Google.',
  ],
];

const CAMBIOS_INFO = [
  [
    'Contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA). Contratando del 1 al 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA).',
    'Contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA).',
  ],
  [
    'creamos la ficha de Google Maps del negocio.',
    'creamos la ficha de Google Maps del negocio. No garantizamos el primer lugar en Google ni una posición en los resultados.',
  ],
];

function reemplazar(texto, antes, despues, donde) {
  const veces = texto.split(antes).length - 1;
  if (veces !== 1) throw new Error(`En ${donde} la frase aparece ${veces} veces (se esperaba 1): "${antes.slice(0, 70)}…"`);
  return texto.replace(antes, () => despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  const guionAntes = e.guionAtencion || '';
  const infoAntes = e.informacionAdicional || '';
  if (!/50\s?%/.test(guionAntes) && !/50\s?%/.test(infoAntes)) {
    console.log('El bot ya no menciona la promo del 50%. No hay nada que hacer.');
    return;
  }
  let guion = guionAntes;
  for (const [antes, despues] of CAMBIOS_GUION) guion = reemplazar(guion, antes, despues, 'el guion');
  let info = infoAntes;
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');
  if (/50\s?%/.test(guion) || /50\s?%/.test(info)) {
    throw new Error('Después de los cambios todavía queda un "50%" en el guion o la información: revisar a mano.');
  }

  console.log(`Empresa: ${e.nombre}\n`);
  for (const [antes, despues] of [...CAMBIOS_GUION, ...CAMBIOS_INFO]) {
    console.log(`ANTES:   ${antes}\nDESPUÉS: ${despues}\n`);
  }
  console.log(`=== GUION NUEVO ===\n${guion}\n\n=== INFORMACIÓN NUEVA ===\n${info}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_quitar-promo-50-multidigital-02nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: guionAntes, informacionAdicional: infoAntes })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
