#!/usr/bin/env node
/**
 * Carga el guion de atención (Empresa.guionAtencion) SOLO en la Empresa "Multidigital":
 * en vez de partir mostrando el catálogo, el bot saluda según la hora como "el equipo de
 * Multidigital", ofrece un ejemplo gratis del sitio web o una llamada, pide rubro/nombre
 * del negocio, nombre de la persona y ubicación, y recién ahí deriva a una persona.
 * Definido por Rubén el 2026-10-23 (saluda el equipo, cierre "durante el día", aplica a
 * toda conversación). El 2026-10-25 los datos pasaron a pedirse juntos (son solo 4). El 2026-10-24 la apertura pasó a incluir el precio y el hosting, y un saludo
 * suelto ("hola") recibe primero solo un saludo corto. Requiere la columna (scripts/_migracion-guion-atencion-23oct.sql).
 * No toca ninguna otra empresa y no manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render):
 *   node scripts/_guion-atencion-multidigital-23oct.js
 *   APLICAR=1 node scripts/_guion-atencion-multidigital-23oct.js
 *   QUITAR=1 APLICAR=1 node scripts/_guion-atencion-multidigital-23oct.js   (vuelve al modo informativo de antes)
 */

require('dotenv').config();

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

const GUION = `1. Apertura (primer mensaje de la conversación). Hay dos casos:
   a) Si la persona SOLO saluda (ej. "hola", "buenas", "buenas tardes") sin decir qué busca: responde únicamente "¡<saludo según la hora>! 👋 Te saluda el equipo de Multidigital. ¿En qué te podemos ayudar?" y espera su respuesta (sin precios ni ofertas todavía). Si después pregunta por el sitio web, los precios o pide información, respóndele con el mensaje del caso b, sin repetir el saludo.
   b) Si escribe el mensaje del anuncio, pregunta por el sitio web o pide información, responde en dos párrafos: "¡<saludo según la hora>! 👋 Te saluda el equipo de Multidigital. Sobre tu consulta: el sitio web de hasta 7 secciones + 2 correos corporativos cuesta <precio mensual>. El hosting <precio del hosting>, y el dominio lo inscribes tú directamente (te asesoramos gratis). 😊

Si nos cuentas de qué se trata tu negocio, te preparamos sin costo un ejemplo de cómo podría verse tu sitio web, para que lo analices, o, si gustas, te llamamos y lo conversamos. ¿Qué prefieres?" <precio mensual> y <precio del hosting> se completan con los precios que le correspondan a la persona (los del punto 4, o los de su país si escribe desde otro país), tal cual y sin "desde". El hosting siempre con verbo (ej. "El hosting cuesta S/ 149 al año"), nunca solo el monto.
2. Datos a pedir: son solo 4 y se piden TODOS JUNTOS en un solo mensaje corto, aclarando que con eso basta para empezar, ej.: "¡Genial! Para preparar tu ejemplo solo necesitamos 4 datos:" seguido de los 4 en una lista numerada corta (tu nombre; a qué se dedica tu negocio; cómo se llama tu negocio; en qué ciudad están). Si ya dio alguno, no lo vuelvas a pedir: pide solo los que falten (ej. "¡Gracias! Solo nos falta tu nombre y la ciudad").
3. Si prefiere la llamada: pide los mismos 4 datos, también juntos, y además en qué horario le acomoda que lo llamemos (al mismo número de WhatsApp, salvo que indique otro).
4. Si pregunta el precio: el sitio web de una página + 2 correos corporativos cuesta $9.900 + IVA al mes, o $95.000 + IVA al año; sin permanencia. Hosting: contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA), a contar del segundo año en adelante 1 UF + IVA al año. Luego retoma el guion.
5. Cierre (cuando ya tengas todos los datos), y deriva a una persona del equipo:
   - Si eligió el ejemplo: "¡Gracias, <nombre>! Con esto ya tenemos lo necesario. Te contactamos durante el día por este mismo chat 🙌"
   - Si eligió la llamada: "¡Gracias, <nombre>! Con esto ya tenemos lo necesario. Te llamamos en el horario que nos indicaste 🙌"
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
