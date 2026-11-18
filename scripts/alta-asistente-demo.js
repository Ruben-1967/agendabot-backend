#!/usr/bin/env node
/**
 * Asistente de ventas IA para una DEMO de sitio web (muestras.multidigital.cl), 2026-11-18.
 *
 * Todas las demos comparten UNA empresa ("Demos Multidigital", modo informativo); cada demo
 * es una fila de AsistenteWeb con su clave ("demo-<slug>"), su información y su guion, que
 * reemplazan a los de la empresa solo para esa clave (src/lib/asistenteWeb.js).
 *   - Solo funciona en muestras.multidigital.cl.
 *   - El WhatsApp dentro del chat es el del prospecto (como en su sitio real).
 *   - Los interesados que dejen sus datos llegan por correo a contacto@multidigital.cl.
 *   - Tope de conversaciones nuevas al mes por demo (30 por defecto) y fecha de vencimiento
 *     (45 días por defecto): pasada esa fecha responde "no disponible" sin llamar al modelo.
 *
 * No envía mensajes ni correos. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción; el JSON se puede pegar con cat > /tmp/demo.json):
 *   node scripts/alta-asistente-demo.js /tmp/demo.json             (muestra qué haría)
 *   APLICAR=1 node scripts/alta-asistente-demo.js /tmp/demo.json   (crea o actualiza)
 *   BAJA=1 APLICAR=1 node scripts/alta-asistente-demo.js demo-terrabliss   (apaga la demo)
 *
 * JSON mínimo: { "clave": "demo-terrabliss", "nombreNegocio": "Terrabliss",
 *   "whatsapp": "56935682148", "informacion": "..." }  Opcionales: guion, saludo, color,
 *   dias (vigencia), conversacionesMes.
 * En la demo, antes de </body>:
 *   <script src="https://agendabot-backend-bbw5.onrender.com/chat-web/widget.js" data-clave="demo-terrabliss" defer></script>
 * y SIN botón flotante de WhatsApp (el WhatsApp va dentro del chat).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const WIDGET = 'https://agendabot-backend-bbw5.onrender.com/chat-web/widget.js';
const EMPRESA_ID_MULTIDIGITAL = process.env.EMPRESA_ID_CLIENTES_WEB || 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const NOMBRE_EMPRESA_DEMOS = 'Demos Multidigital';
const ORIGEN_CASO_DEMOS = 'ASISTENTE_DEMO';
const ORIGENES = ['muestras.multidigital.cl'];
const CORREO_AVISOS = ['contacto@multidigital.cl'];
const DIAS_POR_DEFECTO = 45;
const CONVERSACIONES_POR_DEFECTO = 30;
const ENCABEZADO_INFO = 'Esta es la ÚNICA información que puedes citar sobre';

function guionDemo(negocio) {
  return [
    `1. Eres el asistente del sitio web de ${negocio}. Responde las consultas con la información de ${negocio}, en mensajes cortos y cordiales. Si la persona solo saluda, pregúntale en qué la puedes ayudar.`,
    '2. No informes precios ni valores: no están publicados. Si pregunta cuánto cuesta algo, ofrécele una cotización sin compromiso.',
    '3. Si la persona quiere cotizar, agendar, pide una visita o quiere que la contacten, pídele en un solo mensaje: su nombre, su número de WhatsApp con código de país (ej. +56 9 1234 5678) y qué necesita (y su comuna, si aplica). Si ya dio alguno de esos datos, no lo vuelvas a pedir.',
    '4. Cuando tengas su nombre y su WhatsApp, cierra con: "¡Gracias, <nombre>! Ya dejé tus datos para que te contacten por WhatsApp a la brevedad 🙌" y deriva a una persona del equipo.',
    '5. Si pregunta algo que no está en la información (horarios, dirección, años de experiencia, garantías, convenios), no lo inventes: ofrece que la contacten y pide sus datos como en el punto 3.',
    'Trata siempre de "tú" (nunca "usted" ni voseo). Español de Chile.',
  ].join('\n');
}

function soloDigitos(v) { return String(v || '').replace(/\D/g, ''); }

function leerDatos(archivo, ahora = new Date()) {
  const d = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const errores = [];
  const clave = String(d.clave || '').toLowerCase();
  if (!/^demo-[a-z0-9-]{2,35}$/.test(clave)) errores.push('clave: debe partir con "demo-" y tener solo minúsculas, números y guiones, ej. "demo-terrabliss"');
  const negocio = String(d.nombreNegocio || '').trim();
  if (!negocio) errores.push('nombreNegocio es obligatorio');
  const whatsapp = soloDigitos(d.whatsapp);
  if (!/^\d{10,15}$/.test(whatsapp)) errores.push('whatsapp: el del prospecto, con código de país, ej. "56935682148"');
  const info = String(d.informacion || '').trim();
  if (info.length < 80) errores.push('informacion: falta (o es muy corta) la información de la demo');
  if (/\$\s?\d/.test(info)) errores.push('informacion: trae precios ($): en las demos no se informan valores');
  if (d.color && !/^#[0-9a-fA-F]{6}$/.test(d.color)) errores.push('color: formato #RRGGBB');
  const dias = Number(d.dias || DIAS_POR_DEFECTO);
  if (!Number.isInteger(dias) || dias < 1 || dias > 120) errores.push('dias: entre 1 y 120');
  const conversacionesMes = Number(d.conversacionesMes || CONVERSACIONES_POR_DEFECTO);
  if (!Number.isInteger(conversacionesMes) || conversacionesMes < 1 || conversacionesMes > 100) errores.push('conversacionesMes: entre 1 y 100');
  if (errores.length) throw new Error(`Revisa ${archivo}:\n- ${errores.join('\n- ')}`);

  return {
    clave,
    nombreNegocio: negocio,
    titulo: `Asistente ${negocio}`,
    saludo: d.saludo || `Hola, soy el asistente de ${negocio}.\nEstoy para ayudarte, ¿qué necesitas saber?`,
    color: d.color || '#1D4ED8',
    whatsapp,
    origenes: ORIGENES,
    correoAvisos: CORREO_AVISOS,
    conversacionesMes,
    demo: true,
    informacion: info.startsWith(ENCABEZADO_INFO) ? info
      : `${ENCABEZADO_INFO} ${negocio}. Si te preguntan algo que no está aquí, no lo inventes: ofrece que la contacten por WhatsApp.\n${info}`,
    guion: d.guion ? String(d.guion).trim() : guionDemo(negocio),
    venceEn: new Date(ahora.getTime() + dias * 86400000),
  };
}

// Empresa contenedora de todas las demos: se busca por EMPRESA_ID_DEMOS o por nombre +
// origenCaso; si no existe, se crea (sin WhatsApp, sin usuarios, sin suscripción).
async function buscarEmpresaDemos(prisma) {
  if (process.env.EMPRESA_ID_DEMOS) {
    const e = await prisma.empresa.findUnique({ where: { id: process.env.EMPRESA_ID_DEMOS } });
    if (!e) throw new Error(`EMPRESA_ID_DEMOS=${process.env.EMPRESA_ID_DEMOS} no existe`);
    return e;
  }
  return prisma.empresa.findFirst({ where: { nombre: NOMBRE_EMPRESA_DEMOS, origenCaso: ORIGEN_CASO_DEMOS } });
}

async function darDeBaja(prisma, clave) {
  const fila = await prisma.asistenteWeb.findUnique({ where: { clave } });
  if (!fila) throw new Error(`No existe el asistente "${clave}"`);
  if (!fila.demo) throw new Error(`"${clave}" no es de una demo: no lo apago desde aquí`);
  console.log(`APAGAR asistente de demo "${clave}" (${fila.nombreNegocio}).`);
  if (process.env.APLICAR !== '1') { console.log('DRY-RUN: no se guardó nada.'); return; }
  await prisma.asistenteWeb.update({ where: { clave }, data: { activo: false, venceEn: new Date() } });
  console.log('✅ Apagado. Puede tardar hasta 1 minuto (caché). Recuerda quitar el <script> de la demo.');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Uso: node scripts/alta-asistente-demo.js <archivo.json>  |  BAJA=1 ... demo-<slug>');
  const prisma = require('../src/lib/prisma');
  try {
    if (process.env.BAJA === '1') return await darDeBaja(prisma, String(arg).toLowerCase());

    const datos = leerDatos(path.resolve(arg));
    const existente = await prisma.asistenteWeb.findUnique({ where: { clave: datos.clave } });
    if (existente && !existente.demo) throw new Error(`La clave "${datos.clave}" ya es de un asistente que NO es demo.`);
    const empresaDemos = await buscarEmpresaDemos(prisma);
    if (empresaDemos && empresaDemos.id === EMPRESA_ID_MULTIDIGITAL) throw new Error('La empresa de demos no puede ser la de Multidigital');
    if (empresaDemos && (!empresaDemos.modoInformativo || empresaDemos.whatsappNumeroId)) {
      throw new Error(`La empresa ${empresaDemos.id} no está en modo informativo o tiene WhatsApp: no la uso para demos.`);
    }
    if (existente && empresaDemos && existente.empresaId !== empresaDemos.id) {
      throw new Error(`La clave "${datos.clave}" apunta a la empresa ${existente.empresaId}, no a la de demos (${empresaDemos.id}).`);
    }
    const plantilla = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID_MULTIDIGITAL }, select: { rubroTemplateId: true } });
    if (!empresaDemos && !plantilla) throw new Error('No encontré la empresa de Multidigital para copiar el rubro');

    const { clave, ...datosAsistente } = datos;
    console.log(`${existente ? 'ACTUALIZAR' : 'CREAR'} asistente de demo "${clave}" — empresa ${empresaDemos ? `${empresaDemos.id} (${empresaDemos.nombre})` : `NUEVA "${NOMBRE_EMPRESA_DEMOS}"`}`);
    console.log(JSON.stringify({
      ...datosAsistente,
      informacion: `${datos.informacion.slice(0, 160)}… (${datos.informacion.length} caracteres)`,
      guion: `${datos.guion.slice(0, 80)}…`,
    }, null, 2));

    if (process.env.APLICAR !== '1') {
      console.log(`\nDRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/alta-asistente-demo.js ${arg}`);
      return;
    }
    const resultado = await prisma.$transaction(async (tx) => {
      const emp = empresaDemos || await tx.empresa.create({
        data: {
          nombre: NOMBRE_EMPRESA_DEMOS,
          modoInformativo: true,
          origenCaso: ORIGEN_CASO_DEMOS,
          rubroTemplateId: plantilla.rubroTemplateId,
          emailContacto: CORREO_AVISOS[0],
          // Solo de respaldo: cada demo usa su propia información y guion.
          informacionAdicional: `${ENCABEZADO_INFO} este negocio. No hay información cargada: ofrece que la contacten por WhatsApp.`,
          guionAtencion: guionDemo('este negocio'),
        },
      });
      // Re-alta de una demo apagada: se vuelve a encender (es una demo nueva para ese prospecto).
      const asis = await tx.asistenteWeb.upsert({
        where: { clave },
        update: { ...datosAsistente, activo: true },
        create: { ...datosAsistente, activo: true, clave, empresaId: emp.id },
      });
      return { emp, asis };
    });
    console.log(`\n✅ Listo. Empresa de demos ${resultado.emp.id}, asistente "${resultado.asis.clave}", vence ${resultado.asis.venceEn.toISOString().slice(0, 10)}.`);
    if (!empresaDemos) console.log(`(Empresa creada. Opcional: EMPRESA_ID_DEMOS=${resultado.emp.id} en Render.)`);
    console.log('Puede tardar hasta 1 minuto en tomar los cambios (caché).');
    console.log('\nPega esta línea en la demo, antes de </body> (y quita el botón flotante de WhatsApp):');
    console.log(`<script src="${WIDGET}" data-clave="${clave}" defer></script>`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('❌', err.message); process.exitCode = 1; });
}

module.exports = { leerDatos, guionDemo };
