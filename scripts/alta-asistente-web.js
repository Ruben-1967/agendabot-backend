#!/usr/bin/env node
/**
 * Alta (o actualización) del Asistente 24/7 de un negocio cliente en su sitio web.
 *
 * Lee un archivo JSON con los datos del negocio (ver datos/asistentes-web/_plantilla.json),
 * crea su Empresa en modo informativo (o actualiza la existente) y su fila en AsistenteWeb,
 * e imprime la línea <script> que hay que pegar en el sitio. Volver a correrlo con el mismo
 * archivo ACTUALIZA la información (para los cambios mensuales del cliente).
 *
 * No envía mensajes ni correos. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/alta-asistente-web.js datos/asistentes-web/iace.json
 *   APLICAR=1 node scripts/alta-asistente-web.js datos/asistentes-web/iace.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { ASISTENTES_WEB } = require('../src/lib/asistenteWeb');

const WIDGET = 'https://agendabot-backend-bbw5.onrender.com/chat-web/widget.js';
const EMPRESA_ID_MULTIDIGITAL = process.env.EMPRESA_ID_CLIENTES_WEB || 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const CONVERSACIONES_POR_PLAN = { ASISTENTE: 150, PRO: 400 };

// Guion por defecto para los negocios clientes: responder con la información y, cuando la
// persona quiere avanzar, pedir nombre + WhatsApp antes de derivar (si no, el aviso al
// negocio llega sin forma de contactarla).
function guionPorDefecto(negocio) {
  return [
    `1. Responde las consultas de la persona con la información de ${negocio}, en mensajes cortos y cordiales. Si es su primer mensaje y solo saluda, pregúntale en qué la puedes ayudar.`,
    '2. Si la persona quiere cotizar, comprar, agendar, pide una visita o quiere que la contacten, pídele en un solo mensaje: su nombre, su número de WhatsApp con código de país (ej. +56 9 1234 5678) y, si todavía no lo dijo, qué necesita (y su comuna, si el negocio atiende a domicilio). Si ya dio alguno de esos datos, no lo vuelvas a pedir.',
    `3. Cuando tengas su nombre y su WhatsApp, cierra con: "¡Gracias, <nombre>! Ya le avisé al equipo de ${negocio} y te contactan por WhatsApp a la brevedad 🙌" y deriva a una persona del equipo.`,
    '4. Si pregunta algo que no está en la información, no lo inventes: ofrécele que una persona del equipo la contacte y pide sus datos como en el punto 2.',
    'Trata siempre de "tú" (nunca "usted" ni voseo).',
  ].join('\n');
}

// Mismo día N meses después; si ese mes es más corto (ej. 30-nov + 3 meses), el último día.
function sumarMeses(fecha, meses) {
  const d = new Date(fecha);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}

function soloDigitos(v) { return String(v || '').replace(/\D/g, ''); }
function host(v) {
  const s = String(v || '').trim().toLowerCase();
  try { return new URL(s.includes('://') ? s : `https://${s}`).hostname; } catch { return null; }
}

function leerDatos(archivo) {
  const d = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const errores = [];
  const clave = String(d.clave || '').toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(clave)) errores.push('clave: solo minúsculas, números y guiones (3 a 40), ej. "iace"');
  else if (Object.prototype.hasOwnProperty.call(ASISTENTES_WEB, clave)) errores.push(`clave: "${clave}" está reservada (asistente fijo del sistema)`);
  if (!d.nombreNegocio) errores.push('nombreNegocio es obligatorio');
  if (!d.informacion || String(d.informacion).trim().length < 80) errores.push('informacion: falta (o es muy corta) la información del negocio');
  const sitios = [...new Set((d.sitios || []).flatMap((s) => { const h = host(s); return h ? (h.startsWith('www.') ? [h, h.slice(4)] : [h, `www.${h}`]) : []; }))];
  if (!sitios.length) errores.push('sitios: indica al menos un dominio, ej. ["iace.cl"]');
  const correoAvisos = (d.correoAvisos || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  if (!correoAvisos.length || correoAvisos.some((c) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))) errores.push('correoAvisos: al menos un correo válido');
  const whatsapp = soloDigitos(d.whatsapp);
  if (d.whatsapp && !/^\d{10,15}$/.test(whatsapp)) errores.push('whatsapp: con código de país, ej. "56964256705"');
  const plan = String(d.plan || 'ASISTENTE').toUpperCase();
  if (!CONVERSACIONES_POR_PLAN[plan]) errores.push('plan: "ASISTENTE" (150 conversaciones) o "PRO" (400)');
  if (d.color && !/^#[0-9a-fA-F]{6}$/.test(d.color)) errores.push('color: formato #RRGGBB');
  if (errores.length) throw new Error(`Revisa ${archivo}:\n- ${errores.join('\n- ')}`);

  const meses = Number(d.mesesGratis || 0);
  const gratisHasta = meses > 0 ? sumarMeses(new Date(), meses) : null;
  return {
    clave,
    empresaId: d.empresaId || null,
    nombreNegocio: String(d.nombreNegocio).trim(),
    titulo: d.titulo || `Asistente ${String(d.nombreNegocio).trim()}`,
    saludo: d.saludo || `¡Hola! 👋 Soy el asistente de ${String(d.nombreNegocio).trim()}. ¿En qué te puedo ayudar?`,
    color: d.color || '#1D4ED8',
    whatsapp: whatsapp || null,
    origenes: sitios,
    correoAvisos,
    conversacionesMes: CONVERSACIONES_POR_PLAN[plan],
    gratisHasta,
    informacion: String(d.informacion).trim(),
    guionDado: d.guion ? String(d.guion).trim() : null,
    guion: d.guion ? String(d.guion).trim() : guionPorDefecto(String(d.nombreNegocio).trim()),
    sitioWeb: d.sitioWeb || `https://${sitios.find((s) => !s.startsWith('www.')) || sitios[0]}`,
  };
}

async function main() {
  const archivo = process.argv[2];
  if (!archivo) throw new Error('Uso: node scripts/alta-asistente-web.js datos/asistentes-web/<cliente>.json');
  const datos = leerDatos(path.resolve(archivo));
  const prisma = require('../src/lib/prisma');
  try {
    const existente = await prisma.asistenteWeb.findUnique({ where: { clave: datos.clave } });
    if (existente && datos.empresaId && datos.empresaId !== existente.empresaId) {
      throw new Error(`La clave "${datos.clave}" ya es de la empresa ${existente.empresaId}, no de ${datos.empresaId}. Revisa el archivo.`);
    }
    const empresaId = datos.empresaId || existente?.empresaId || null;
    const empresa = empresaId ? await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { suscripcion: true, asistenteWeb: true, _count: { select: { usuarios: true } } },
    }) : null;
    if (empresaId && !empresa) throw new Error(`No existe la empresa ${empresaId}`);
    if (empresa && empresa.id === EMPRESA_ID_MULTIDIGITAL) throw new Error('Este script no es para la empresa de Multidigital');
    if (empresa && empresa.asistenteWeb && empresa.asistenteWeb.clave !== datos.clave) {
      throw new Error(`La empresa ${empresa.id} ya tiene el asistente "${empresa.asistenteWeb.clave}".`);
    }
    // Empresa que ya usa AgendaBot (bot de WhatsApp, suscripción o usuarios del panel): este
    // script le cambiaría el modo, la información y el guion. Solo con FORZAR=1, a propósito.
    if (empresa && !existente && process.env.FORZAR !== '1'
      && (!empresa.modoInformativo || empresa.whatsappNumeroId || empresa.suscripcion || empresa._count.usuarios > 0)) {
      throw new Error(`La empresa ${empresa.id} (${empresa.nombre}) ya usa AgendaBot (WhatsApp, suscripción o usuarios): no la modifico. Si de verdad corresponde, corre con FORZAR=1.`);
    }
    const plantilla = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID_MULTIDIGITAL }, select: { rubroTemplateId: true } });
    if (!plantilla) throw new Error('No encontré la empresa de Multidigital para copiar el rubro');

    // Sin telefonoContacto: ese número recibe las alertas por WhatsApp de AgendaBot; los
    // negocios del asistente web reciben los interesados por correo.
    // Al actualizar, si el archivo no trae guion se respeta el que ya tiene (pudo ajustarse a mano).
    const datosEmpresa = {
      nombre: datos.nombreNegocio,
      modoInformativo: true,
      informacionAdicional: datos.informacion,
      guionAtencion: empresa && !datos.guionDado && empresa.guionAtencion ? empresa.guionAtencion : datos.guion,
      sitioWeb: datos.sitioWeb,
      emailContacto: datos.correoAvisos[0],
    };
    const datosAsistente = {
      titulo: datos.titulo, nombreNegocio: datos.nombreNegocio, saludo: datos.saludo, color: datos.color,
      whatsapp: datos.whatsapp, origenes: datos.origenes, correoAvisos: datos.correoAvisos,
      conversacionesMes: datos.conversacionesMes,
      ...(datos.gratisHasta && !existente?.gratisHasta ? { gratisHasta: datos.gratisHasta } : {}),
    };
    // activo solo se fija al crear: actualizar la información no reactiva un asistente apagado.
    if (existente && !existente.activo) console.log('⚠️  Este asistente está APAGADO (activo=false); se actualiza sin encenderlo.');

    console.log(`${existente ? 'ACTUALIZAR' : 'CREAR'} asistente "${datos.clave}" — ${empresa ? `empresa existente ${empresa.id} (${empresa.nombre})` : 'empresa NUEVA'}`);
    console.log(JSON.stringify({ empresa: { ...datosEmpresa, informacionAdicional: `${datos.informacion.slice(0, 120)}… (${datos.informacion.length} caracteres)`, guionAtencion: `${datos.guion.slice(0, 80)}…` }, asistente: datosAsistente }, null, 2));

    if (process.env.APLICAR !== '1') {
      console.log(`\nDRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/alta-asistente-web.js ${archivo}`);
      return;
    }
    if (empresa) {
      console.log(`=== RESPALDO empresa (texto anterior) ===\n${JSON.stringify({ informacionAdicional: empresa.informacionAdicional, guionAtencion: empresa.guionAtencion })}`);
    }
    const resultado = await prisma.$transaction(async (tx) => {
      const emp = empresa
        ? await tx.empresa.update({ where: { id: empresa.id }, data: datosEmpresa })
        : await tx.empresa.create({ data: { ...datosEmpresa, rubroTemplateId: plantilla.rubroTemplateId, origenCaso: 'ASISTENTE_WEB' } });
      const asis = await tx.asistenteWeb.upsert({
        where: { clave: datos.clave },
        update: datosAsistente,
        create: { ...datosAsistente, activo: true, clave: datos.clave, empresaId: emp.id },
      });
      return { emp, asis };
    });
    console.log(`\n✅ Listo. Empresa ${resultado.emp.id}, asistente "${resultado.asis.clave}"${resultado.asis.gratisHasta ? `, gratis hasta ${resultado.asis.gratisHasta.toISOString().slice(0, 10)}` : ''}.`);
    console.log('Puede tardar hasta 1 minuto en tomar los cambios (caché).');
    console.log('\nPega esta línea en el sitio, antes de </body>:');
    console.log(`<script src="${WIDGET}" data-clave="${datos.clave}" defer></script>`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('❌', err.message); process.exitCode = 1; });
}

module.exports = { leerDatos, guionPorDefecto, sumarMeses };
