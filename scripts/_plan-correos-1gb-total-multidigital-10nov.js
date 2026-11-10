#!/usr/bin/env node
/**
 * Corrige el Plan Correos en el bot de Multidigital: decía "2 correos de 1 GB cada uno", pero el
 * paquete WHM ohparisc_solocorreos da 1 GB para toda la cuenta, compartido entre los 2 correos.
 * Decisión de Rubén del 10-nov: queda en 1 GB en total por ahora (se ampliará a 2 GB cuando haya
 * un hosting con más capacidad). Detectado al crear el primer cliente (Comercial Isidora).
 *
 * Reemplaza frases exactas; si alguna no calza, se detiene sin guardar nada. Imprime el
 * texto anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_plan-correos-1gb-total-multidigital-10nov.js
 *   APLICAR=1 node scripts/_plan-correos-1gb-total-multidigital-10nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

const CAMBIOS_GUION = [
  ['2 correos con tu dominio (por ejemplo contacto@tuempresa.cl), de 1 GB cada uno,',
    '2 correos con tu dominio (por ejemplo contacto@tuempresa.cl), con 1 GB de espacio en total entre los dos,'],
];

const CAMBIOS_INFO = [
  ['2 correos corporativos con el dominio del cliente, de 1 GB cada uno.',
    '2 correos corporativos con el dominio del cliente, con 1 GB de espacio en total, compartido entre los dos.'],
];

function reemplazar(texto, antes, despues, donde) {
  const veces = texto.split(antes).length - 1;
  if (veces !== 1) throw new Error(`En ${donde} la frase aparece ${veces} veces (se esperaba 1): "${antes.slice(0, 70)}…"`);
  return texto.replace(antes, () => despues);
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  if ((e.informacionAdicional || '').includes('1 GB de espacio en total')) {
    console.log('El cambio ya está aplicado. No hay nada que hacer.');
    return;
  }
  let guion = e.guionAtencion || '';
  for (const [antes, despues] of CAMBIOS_GUION) guion = reemplazar(guion, antes, despues, 'el guion');
  let info = e.informacionAdicional || '';
  for (const [antes, despues] of CAMBIOS_INFO) info = reemplazar(info, antes, despues, 'la información');
  if (/1 GB cada uno/.test(guion + info)) throw new Error('Todavía queda "1 GB cada uno" en el texto: revisar a mano.');

  console.log(`Empresa: ${e.nombre}\n`);
  for (const [antes, despues] of [...CAMBIOS_GUION, ...CAMBIOS_INFO]) console.log(`- ${antes}\n+ ${despues}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_plan-correos-1gb-total-multidigital-10nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior, por si hay que volver atrás) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guion, informacionAdicional: info } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
