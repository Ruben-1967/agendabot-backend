#!/usr/bin/env node
/**
 * Agrega el Plan Correos (solo correos, sin sitio web) al bot de Multidigital (pedido de Rubén
 * del 03-nov). Un prospecto escribió "No quiero sitio web, solo correo por el momento" y el bot
 * le dijo que los correos solo vienen con el sitio. Precio confirmado por Rubén el 03-nov:
 * $14.900 + IVA al año, 2 correos de 1 GB (paquete WHM ohparisc_solocorreos).
 * Las frases nuevas llevan "$", así que para Perú, Colombia y México se quitan solas
 * (guionSinPrecios / informacionSinPrecios en claude.js): allá no se ofrece.
 *
 * Reemplaza frases exactas; si alguna no calza, se detiene sin guardar nada. Imprime el
 * texto anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_plan-correos-multidigital-03nov.js
 *   APLICAR=1 node scripts/_plan-correos-multidigital-03nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'Plan Correos';

// Fin del punto 4 (precios). Solo esta frase, así sirve aunque se aplique antes o después
// de _quitar-promo-50-multidigital-02nov.js, que cambia lo que va justo antes.
const ANCLA_PUNTO_4 = 'Luego retoma el guion.';

const CAMBIOS_GUION = [
  [
    ANCLA_PUNTO_4,
    `${ANCLA_PUNTO_4}
   Si dice que quiere solo correos o que no quiere sitio web: en Chile ofrécele el Plan Correos, sin insistir con el sitio: "Claro, también tenemos un plan solo de correos: 2 correos con tu dominio (por ejemplo contacto@tuempresa.cl), de 1 GB cada uno, por $14.900 + IVA al año. Los puedes leer y enviar desde la app de Gmail o de Outlook, y te dejamos todo configurado. Si más adelante quieres tu sitio web, lo sumamos sin perder tus correos." Luego pide juntos su nombre, el nombre de su negocio y si ya tiene un dominio (si no, el dominio lo inscribe a su nombre y lo asesoramos gratis), y cierra con el mensaje del punto 5 (eligió el ejemplo).`,
  ],
];

const CAMBIOS_INFO = [
  [
    '- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.',
    `- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.
- Plan Correos (solo correos, sin sitio web; por ahora solo en Chile): 2 correos corporativos con el dominio del cliente, de 1 GB cada uno. Valor: $14.900 + IVA al año. El dominio lo inscribe el cliente a su nombre y lo asesoramos gratis. Si más adelante quiere el sitio web, se suma sin perder los correos.`,
  ],
  [
    'Solo el sitio web + correos, el asistente para el sitio web y TotemSystem tienen precio indicado aquí.',
    'Solo el sitio web + correos, el Plan Correos, el asistente para el sitio web y TotemSystem tienen precio indicado aquí.',
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
  if ((e.informacionAdicional || '').includes(MARCA)) {
    console.log('El Plan Correos ya está aplicado. No hay nada que hacer.');
    return;
  }
  let guion = e.guionAtencion || '';
  for (const [antes, despues] of CAMBIOS_GUION) guion = reemplazar(guion, antes, despues, 'el guion');
  let info = e.informacionAdicional || '';
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');

  console.log(`Empresa: ${e.nombre}\n\n=== GUION NUEVO ===\n${guion}\n\n=== INFORMACIÓN NUEVA ===\n${info}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_plan-correos-multidigital-03nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
