#!/usr/bin/env node
// Uso puntual (2026-10-16): el +56 9 6610 8858 quedó conectado a la Empresa
// "Multidigital", pero un mensaje de prueba figura "entregado" en WhatsApp y NO
// aparece en "Chats en vivo". SOLO LECTURA: revisa, con el token que ya quedó
// guardado en la Empresa (nunca se imprime), por qué Meta no avisa al backend:
//   1. estado del número en Meta (status, plataforma, webhook propio del número)
//   2. qué apps están suscritas a la cuenta de WhatsApp y si alguna tiene una
//      URL de webhook distinta (override) -- eso desvía los mensajes a otro lado
//   3. si en nuestra base llegó algo (Conversacion de esa Empresa)
// No manda ningún mensaje.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-webhook-multidigital-16oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const GRAPH = 'v21.0';

async function graph(ruta, token) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  console.log(`Empresa: ${e.nombre} | WhatsApp: ${e.whatsappPhoneNumber || '(vacío)'} | numberId: ${e.whatsappNumeroId || '(vacío)'} | wabaId: ${e.whatsappWabaId || '(vacío)'} | token guardado: ${e.whatsappToken ? 'sí' : 'no'}`);
  if (!e.whatsappNumeroId || !e.whatsappToken || !e.whatsappWabaId) throw new Error('La Empresa no tiene el WhatsApp completo guardado.');

  console.log('\n[1] Número en Meta');
  const n = await graph(`${e.whatsappNumeroId}?fields=display_phone_number,verified_name,status,platform_type,quality_rating,webhook_configuration,is_pin_enabled,name_status`, e.whatsappToken);
  console.log(n.ok ? JSON.stringify(n.data, null, 1) : `ERROR ${n.status}: ${n.data?.error?.message ? String(n.data.error.message).replace(/EAA[A-Za-z0-9]+/g, '***') : '?'}`);

  console.log('\n[2] Apps suscritas a la cuenta de WhatsApp (WABA)');
  const s = await graph(`${e.whatsappWabaId}/subscribed_apps`, e.whatsappToken);
  console.log(s.ok ? JSON.stringify(s.data, null, 1) : `ERROR ${s.status}: ${s.data?.error?.message ? String(s.data.error.message).replace(/EAA[A-Za-z0-9]+/g, '***') : '?'}`);

  console.log('\n[3] Lo que llegó a nuestra base para esta Empresa');
  const convs = await prisma.conversacion.findMany({ where: { empresaId: EMPRESA_ID }, select: { telefono: true, canal: true, actualizadoEn: true, mensajes: true }, orderBy: { actualizadoEn: 'desc' }, take: 5 });
  console.log(`Conversaciones: ${convs.length}`);
  for (const c of convs) console.log(`  · ***${String(c.telefono).slice(-4)} ${c.canal} ${c.actualizadoEn.toISOString()} (${Array.isArray(c.mensajes) ? c.mensajes.length : 0} mensajes)`);

  console.log(`\nURL de webhook que debería estar configurada en la app: ${process.env.BACKEND_URL ? process.env.BACKEND_URL + '/webhook/whatsapp' : '(BACKEND_URL no definida aquí)'}`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
