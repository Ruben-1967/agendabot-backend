#!/usr/bin/env node
/**
 * Carga el guion de atención (Empresa.guionAtencion) SOLO en la Empresa "Multidigital":
 * en vez de partir mostrando el catálogo, el bot saluda según la hora como "el equipo de
 * Multidigital", ofrece un ejemplo gratis del sitio web o una llamada, pide rubro/nombre
 * del negocio, nombre de la persona y ubicación, y recién ahí deriva a una persona.
 * Definido por Rubén el 2026-10-23 (saluda el equipo, cierre "durante el día", aplica a
 * toda conversación). Requiere la columna (scripts/_migracion-guion-atencion-23oct.sql).
 * No toca ninguna otra empresa y no manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render):
 *   node scripts/_guion-atencion-multidigital-23oct.js
 *   APLICAR=1 node scripts/_guion-atencion-multidigital-23oct.js
 *   QUITAR=1 APLICAR=1 node scripts/_guion-atencion-multidigital-23oct.js   (vuelve al modo informativo de antes)
 */

require('dotenv').config();

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

const GUION = `1. Apertura (primer mensaje de la conversación): "¡<saludo según la hora>! 👋 Te saluda el equipo de Multidigital. Si nos cuentas de qué se trata tu negocio, te preparamos sin costo un ejemplo de cómo podría verse tu sitio web, para que lo analices. O, si prefieres, te llamamos y lo conversamos. ¿Qué prefieres?"
2. Datos a pedir (de a uno o dos por mensaje, en este orden): de qué se trata el negocio y cómo se llama; el nombre de la persona; en qué comuna o ciudad están.
3. Si prefiere la llamada: pide los mismos datos y además en qué horario le acomoda que lo llamemos (al mismo número de WhatsApp, salvo que indique otro).
4. Si pregunta el precio: el sitio web de una página + 2 correos corporativos cuesta $9.900 + IVA al mes, o $95.000 + IVA al año; sin permanencia. Luego retoma el guion.
5. Cierre (cuando ya tengas todos los datos): "¡Gracias, <nombre>! Con esto ya tenemos lo necesario. Te contactamos durante el día por este mismo chat 🙌", y deriva a una persona del equipo.
Trata siempre de "tú" (nunca "usted" ni voseo).`;

async function main() {
  const prisma = require('../src/lib/prisma');
  try {
    const aplicar = process.env.APLICAR === '1';
    const quitar = process.env.QUITAR === '1';
    const e = await prisma.empresa.findUnique({
      where: { id: EMPRESA_ID },
      select: { nombre: true, modoInformativo: true, guionAtencion: true },
    });
    if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
    if (!e.modoInformativo) throw new Error('Multidigital no está en modo informativo: el guion no tendría efecto. No se hace nada.');

    const nuevo = quitar ? null : GUION;
    console.log(`Empresa: ${e.nombre} | guion actual: ${e.guionAtencion ? 'sí' : 'no'} -> ${nuevo ? 'guion nuevo' : 'sin guion'}`);
    if (nuevo) console.log(`\n${GUION}\n`);
    if (e.guionAtencion === nuevo) { console.log('Ya estaba así: nada que cambiar.'); return; }
    if (!aplicar) { console.log('DRY-RUN: no se escribió nada. Para aplicar: APLICAR=1'); return; }

    await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: nuevo } });
    console.log(nuevo ? '✅ Guion de atención cargado en Multidigital.' : '✅ Guion quitado: vuelve al modo informativo de antes.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
}

module.exports = { GUION };
