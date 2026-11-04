#!/usr/bin/env node
/**
 * Agrega al bot de Multidigital las 2 versiones de TotemSystem (plan oficial, decisión de Rubén
 * del 04-nov): simple, $5.000 + IVA al mes, y con panel de control, desde $14.900 + IVA al mes.
 * Antes el bot solo conocía "desde $14.900". Las frases llevan "$", así que para Perú, Colombia
 * y México se quitan solas (informacionSinPrecios en claude.js).
 *
 * Reemplaza una frase exacta; si no calza, se detiene sin guardar nada. Imprime el texto
 * anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_totem-simple-multidigital-04nov.js
 *   APLICAR=1 node scripts/_totem-simple-multidigital-04nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'TotemSystem simple';

const CAMBIOS_INFO = [
  [
    '- TotemSystem, WhatsApp con IA: asistente que agenda, atiende y vende por WhatsApp las 24 horas, adaptado al rubro del negocio. Desde $14.900 al mes + IVA.',
    '- TotemSystem, WhatsApp con IA: tiene 2 versiones, adaptadas al rubro del negocio. TotemSystem simple: asistente con IA que atiende por WhatsApp las 24 horas, a $5.000 + IVA al mes. TotemSystem con panel de control: además agenda, vende, responde consultas y toma los datos de los clientes, desde $14.900 + IVA al mes. No lo confundas con el asistente para el sitio web, que es otro producto.',
  ],
];

function reemplazar(texto, antes, despues, donde) {
  const veces = texto.split(antes).length - 1;
  if (veces !== 1) throw new Error(`En ${donde} la frase aparece ${veces} veces (se esperaba 1): "${antes.slice(0, 70)}…"`);
  return texto.replace(antes, () => despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  const infoAntes = e.informacionAdicional || '';
  if (infoAntes.includes(MARCA)) {
    console.log('TotemSystem simple ya está aplicado. No hay nada que hacer.');
    return;
  }
  let info = infoAntes;
  for (const [antes, despues] of CAMBIOS_INFO) {
    info = reemplazar(info, antes, despues, 'la información');
    console.log(`Empresa: ${e.nombre}\n\nANTES:   ${antes}\nDESPUÉS: ${despues}\n`);
  }
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_totem-simple-multidigital-04nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ informacionAdicional: infoAntes })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
