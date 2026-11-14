#!/usr/bin/env node
/**
 * Nueva oferta de Chile (decisión de Rubén del 14-nov-2026, rige desde ya aunque el aviso de Meta
 * todavía diga "Hosting 20%"):
 *   - Primera cuota $49.900 + IVA: sitio + 2 correos + hosting + dominio .cl del primer año.
 *   - Después $9.900 + IVA al mes, "que incluye la mantención" (definida igual que en el contrato).
 *   - Si el cliente ya tiene dominio o no lo quiere: primera cuota = $9.900 + IVA + hosting
 *     (el precio del aviso: hosting 0,9 UF + IVA, con 20% el primer año hasta el 30-nov).
 *   - Apertura más corta, que pide de una vez los 4 datos para la demo.
 *   - "Autoadministrable" (planilla de Google) solo si el cliente lo pide, caso a caso, sin costo.
 * Perú, Colombia y México NO cambian.
 *
 * Cambia guion e información de la Empresa Multidigital buscando frases ancla; si alguna no
 * calza, se detiene SIN guardar y muestra el texto actual. Imprime el texto anterior como
 * respaldo antes de guardar. DRY-RUN por defecto. No manda mensajes.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_oferta-dominio-49900-multidigital-14nov.js
 *   APLICAR=1 node scripts/_oferta-dominio-49900-multidigital-14nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = '$49.900 + IVA';

const MANTENCION = 'hasta 3 cambios menores al mes, renovación del certificado SSL, actualizaciones técnicas y de seguridad, '
  + 'revisión de los correos y del botón de WhatsApp, y soporte por WhatsApp o correo en días hábiles';

const APERTURA_CHILE = `   En Chile, la apertura del caso b NO usa el mensaje anterior: usa este, tal cual, en tres párrafos cortos (sin mencionar el descuento del hosting ni el pago anual): "¡<saludo según la hora>! 👋 Te saluda el equipo de Multidigital.

Tu sitio web profesional parte con una primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos con tu dominio, el hosting y tu dominio .cl por el primer año. Después son $9.900 + IVA al mes, que incluye la mantención de tu sitio.

Para prepararte sin costo un ejemplo de cómo se vería tu sitio, cuéntanos tu nombre, tu ciudad, a qué se dedica tu negocio y cómo se llama. Con eso partimos." Si en su primer mensaje ya dio alguno de esos datos, pide solo los que falten. Si prefiere que lo llamemos, aplica el punto 3. Nunca digas "11 cuotas" ni des a entender que después de la cuota 12 no se paga: la mensualidad es la mantención y sigue mientras tenga el servicio.`;

const PRECIO_CHILE_P4 = 'tiene una primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos, el hosting y el dominio .cl por el primer año (el dominio queda inscrito a nombre del cliente). '
  + `Después son $9.900 + IVA al mes, que incluye la mantención (${MANTENCION}). `
  + 'A la cuota 12 el sitio es tuyo, y la mantención sigue mientras mantengas el servicio. '
  + 'Si ya tienes dominio o no lo quieres, la primera cuota queda en $9.900 + IVA más el hosting del primer año. '
  + 'Desde el segundo año, en cada aniversario se renuevan el hosting y el dominio. '
  + 'Si pide poder editar el sitio él mismo ("autoadministrable"): se puede, sin costo, según cómo sea su sitio (se ve caso a caso); no lo ofrezcas de entrada. '
  + 'Pago anual: $95.000 + IVA al año;';

const VALOR_INFO = 'Valor (Chile, desde el 14-nov-2026): primera cuota de $49.900 + IVA, que incluye el sitio, 2 correos, el hosting y el dominio .cl del primer año (inscrito a nombre del cliente). '
  + `Después $9.900 + IVA al mes, que incluye la mantención: ${MANTENCION}. `
  + 'La mantención no incluye cambios mayores, contenidos nuevos, publicidad ni la renovación anual del hosting y del dominio. '
  + 'Si el cliente ya tiene dominio o no lo quiere, la primera cuota es $9.900 + IVA más el hosting del primer año. '
  + 'A la cuota 12 el sitio es del cliente, y la mantención sigue mientras mantenga el servicio. '
  + 'Si el cliente lo pide, el sitio puede quedar autoadministrable (editable con una planilla de Google), sin costo y caso a caso. '
  + 'Pago anual';

// [nombre, regex o frase, reemplazo, obligatorio]
const CAMBIOS_GUION = [
  ['apertura Chile', /^ {3}En Chile, <precio mensual> se dice así:.*$/m, APERTURA_CHILE, true],
  ['precio punto 4', 'cuesta $9.900 + IVA al mes, y a la cuota 12 el sitio es tuyo, o $95.000 + IVA al año;', PRECIO_CHILE_P4, true],
  ['asistente en el párrafo del precio', 'al final del primer párrafo agrega', 'al final del párrafo del precio agrega', false],
];
const CAMBIOS_INFO = [
  ['valor', 'Valor: $9.900 + IVA al mes, y a la cuota 12 el sitio es del cliente, o pago anual', VALOR_INFO, true],
];

function aplicar(texto, cambios, donde, errores) {
  let t = texto;
  for (const [nombre, patron, nuevo, obligatorio] of cambios) {
    const n = patron instanceof RegExp ? (t.match(new RegExp(patron.source, patron.flags + 'g')) || []).length : t.split(patron).length - 1;
    console.log(`${donde} · ${nombre}: ${n} coincidencia(s)`);
    if (n === 0 && !obligatorio) continue;
    if (n !== 1) { errores.push(`${donde} · ${nombre}: se esperaba 1 y hay ${n}`); continue; }
    t = t.replace(patron, () => nuevo);
  }
  return t;
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, guionAtencion: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital: no se hace nada.');
  const guion = e.guionAtencion || '';
  const info = e.informacionAdicional || '';
  if ((guion + info).includes(MARCA)) return console.log('Ya está aplicado (aparece $49.900). No hay nada que hacer.');

  const errores = [];
  const guionNuevo = aplicar(guion, CAMBIOS_GUION, 'guion', errores);
  const infoNueva = aplicar(info, CAMBIOS_INFO, 'información', errores);
  if (errores.length) {
    console.log(`\n=== GUION ACTUAL ===\n${guion}\n\n=== INFORMACIÓN ACTUAL ===\n${info}\n`);
    throw new Error(`No se guardó nada. Anclas que no calzaron:\n- ${errores.join('\n- ')}`);
  }
  console.log(`\n=== GUION NUEVO ===\n${guionNuevo}\n\n=== INFORMACIÓN NUEVA ===\n${infoNueva}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_oferta-dominio-49900-multidigital-14nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ guionAtencion: e.guionAtencion, informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { guionAtencion: guionNuevo, informacionAdicional: infoNueva } });
  console.log('✅ Guardado. Prueba escribiendo al WhatsApp de Multidigital desde un número que no sea cliente.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
