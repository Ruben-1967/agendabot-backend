#!/usr/bin/env node
// Uso puntual (2026-10-17): los mensajes que le escriben al +56 9 6610 8858 NO aparecen
// en los logs del servidor (ni como mensaje entrante ni como firma inválida), aunque la
// app figura suscrita a la cuenta de WhatsApp. SOLO LECTURA: revisa si Meta tiene un
// destino de webhook DISTINTO (override) a nivel de la cuenta o del número -- p. ej.
// dejado por la migración que hizo otro asistente -- y cuál es el destino a nivel de app.
// No imprime el token ni manda mensajes.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-webhook-override-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const APP_ID = '1064842162565759'; // AgendaBot Producción
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function get(ruta, token) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, data: await res.json() };
}
const mostrar = (r) => console.log(r.ok ? JSON.stringify(r.data, null, 1) : `ERROR ${r.status}: ${limpiar(r.data?.error?.message)}`);

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre) || !e.whatsappToken || !e.whatsappWabaId || !e.whatsappNumeroId) {
    throw new Error('Falta la Empresa Multidigital con WhatsApp guardado.');
  }

  console.log('[1] Apps suscritas a la cuenta de WhatsApp (busca "override_callback_uri")');
  mostrar(await get(`${e.whatsappWabaId}/subscribed_apps`, e.whatsappToken));

  console.log('\n[2] Destino de webhook propio del NÚMERO (webhook_configuration)');
  mostrar(await get(`${e.whatsappNumeroId}?fields=display_phone_number,webhook_configuration,status,platform_type`, e.whatsappToken));

  console.log('\n[3] Destino de webhook a nivel de APP (objeto whatsapp_business_account)');
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (!secreto) {
    console.log('  WHATSAPP_APP_SECRET no está definida aquí.');
  } else {
    mostrar(await get(`${APP_ID}/subscriptions`, `${APP_ID}|${secreto}`));
  }
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
