#!/usr/bin/env node
// Uso puntual (2026-10-19): el +56 9 6610 8858 vive en la cuenta de mensajes de Multidigital
// 1332495608860251 (la misma que Meta nombra en el error "Paid Message Account"), pero la app
// quedó suscrita a los webhooks de OTRA cuenta (1104660188622739, la "presencia" de WhatsApp).
// Por eso los mensajes entrantes nunca llegan al servidor. Este script:
//   1) lista las apps suscritas a 1332495608860251,
//   2) si AgendaBot Producción no está, la suscribe (mismo paso que hace Embedded Signup),
//   3) vuelve a listar para confirmar.
// Con ACTUALIZAR_WABA=1 además guarda 1332495608860251 como whatsappWabaId de la Empresa
// (por defecto NO toca la base de datos). No imprime el token ni manda mensajes.
//
// USO (Shell de Render, producción):
//   node scripts/_suscribir-cuenta-mensajes-multidigital-19oct.js
//   ACTUALIZAR_WABA=1 node scripts/_suscribir-cuenta-mensajes-multidigital-19oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const CUENTA_MENSAJES = '1332495608860251';
const APP_ID = '1064842162565759'; // AgendaBot Producción
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function llamar(ruta, token, metodo = 'GET') {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, data: await res.json() };
}
const mostrar = (r) => console.log(r.ok ? JSON.stringify(r.data, null, 1) : `ERROR ${r.status}: ${limpiar(r.data?.error?.message)}`);
const appSuscrita = (r) => r.ok && Array.isArray(r.data?.data) && r.data.data.some((x) => x?.whatsapp_business_api_data?.id === APP_ID);

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre) || !e.whatsappToken || !e.whatsappNumeroId) throw new Error('Falta la Empresa Multidigital con WhatsApp guardado.');
  const t = e.whatsappToken;

  console.log(`[1] Números de la cuenta ${CUENTA_MENSAJES} (debe aparecer ${e.whatsappNumeroId})`);
  mostrar(await llamar(`${CUENTA_MENSAJES}/phone_numbers?fields=id,display_phone_number,status`, t));

  console.log('\n[2] Apps suscritas ANTES');
  const antes = await llamar(`${CUENTA_MENSAJES}/subscribed_apps`, t);
  mostrar(antes);

  if (appSuscrita(antes)) {
    console.log('\nLa app ya está suscrita a esta cuenta: no hay nada que cambiar.');
  } else {
    console.log('\n[3] Suscribiendo AgendaBot Producción a esta cuenta...');
    const post = await llamar(`${CUENTA_MENSAJES}/subscribed_apps`, t, 'POST');
    mostrar(post);
    console.log('\n[4] Apps suscritas DESPUÉS');
    mostrar(await llamar(`${CUENTA_MENSAJES}/subscribed_apps`, t));
  }

  if (process.env.ACTUALIZAR_WABA === '1') {
    await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { whatsappWabaId: CUENTA_MENSAJES } });
    console.log(`\n✅ whatsappWabaId de la Empresa actualizado a ${CUENTA_MENSAJES}.`);
  }
  console.log('\nAhora escríbele un "Hola" al +56 9 6610 8858 desde otro teléfono y busca en los logs: 1406508105875281');
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
