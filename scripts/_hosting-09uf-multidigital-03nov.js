#!/usr/bin/env node
/**
 * Deja el hosting del bot de Multidigital igual que los afiches de noviembre (pedido de Rubén
 * del 03-nov): 0,9 UF + IVA al año, y contratando hasta el 30-nov-2026 el primer año tiene 20%
 * de descuento (0,72 UF + IVA). Antes decía 1 UF + IVA (0,8 UF con el 20%).
 *
 * Sirve tanto si _quitar-promo-50-multidigital-02nov.js ya se aplicó como si no: para cada
 * frase busca las dos versiones posibles y exige que calce exactamente una. Si ninguna
 * calza, se detiene sin guardar nada. De paso deja aplicado lo de ese script (sin 50% y
 * "nunca prometas el primer lugar en Google"). Perú, Colombia y México no se tocan: sus
 * precios del hosting salen de otra parte y ahí no hay publicidad.
 *
 * Imprime el texto anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_hosting-09uf-multidigital-03nov.js
 *   APLICAR=1 node scripts/_hosting-09uf-multidigital-03nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = '0,72 UF';

// [versiones posibles del texto actual (sin y con _quitar-promo-50 aplicado), texto nuevo]
const CAMBIOS_GUION = [
  [
    [
      'Hosting: 1 UF + IVA al año; contratando hasta el 31 de octubre de 2026 el primer año tiene 50% de descuento (0,5 UF + IVA), y contratando del 1 al 30 de noviembre de 2026, 20% de descuento (0,8 UF + IVA). Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps).',
      'Hosting: 1 UF + IVA al año; contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA). Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps); nunca prometas el primer lugar en Google.',
    ],
    'Hosting: 0,9 UF + IVA al año; contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,72 UF + IVA). Incluye sin costo la presencia en Google (registramos el sitio y creamos la ficha de Google Maps); nunca prometas el primer lugar en Google.',
  ],
];

const CAMBIOS_INFO = [
  [
    [
      'Hosting: 1 UF + IVA al año. Contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA). Contratando del 1 al 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA). Quien contrate desde el 1 de diciembre de 2026 paga 1 UF + IVA desde el primer año. Incluye sin costo la presencia en Google: registramos el sitio en Google y creamos la ficha de Google Maps del negocio.',
      'Hosting: 1 UF + IVA al año. Contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,8 UF + IVA). Quien contrate desde el 1 de diciembre de 2026 paga 1 UF + IVA desde el primer año. Incluye sin costo la presencia en Google: registramos el sitio en Google y creamos la ficha de Google Maps del negocio. No garantizamos el primer lugar en Google ni una posición en los resultados.',
    ],
    'Hosting: 0,9 UF + IVA al año. Contratando hasta el 30 de noviembre de 2026, el primer año tiene 20% de descuento (0,72 UF + IVA). Quien contrate desde el 1 de diciembre de 2026 paga 0,9 UF + IVA desde el primer año. Incluye sin costo la presencia en Google: registramos el sitio en Google y creamos la ficha de Google Maps del negocio. No garantizamos el primer lugar en Google ni una posición en los resultados.',
  ],
];

function reemplazar(texto, versiones, despues, donde) {
  const calzan = versiones.filter((v) => texto.split(v).length - 1 === 1);
  if (calzan.length !== 1) throw new Error(`En ${donde} no se encontró exactamente una versión de: "${versiones[0].slice(0, 70)}…"`);
  console.log(`ANTES:   ${calzan[0]}\nDESPUÉS: ${despues}\n`);
  return texto.replace(calzan[0], () => despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  const guionAntes = e.guionAtencion || '';
  const infoAntes = e.informacionAdicional || '';
  if (guionAntes.includes(MARCA)) {
    console.log('El hosting de 0,9 UF ya está aplicado. No hay nada que hacer.');
    return;
  }
  console.log(`Empresa: ${e.nombre}\n`);
  let guion = guionAntes;
  for (const [versiones, despues] of CAMBIOS_GUION) guion = reemplazar(guion, versiones, despues, 'el guion');
  let info = infoAntes;
  for (const [versiones, despues] of CAMBIOS_INFO) info = reemplazar(info, versiones, despues, 'la información');

  const resto = /\b1 UF\b|0,8 UF|0,5 UF|50\s?%/.exec(guion + info);
  if (resto) throw new Error(`Después de los cambios todavía queda "${resto[0]}": revisar a mano.`);

  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_hosting-09uf-multidigital-03nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: guionAntes, informacionAdicional: infoAntes })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
