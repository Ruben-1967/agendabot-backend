#!/usr/bin/env node
// Uso puntual (2026-10-17): enviar desde el +56 9 6610 8858 falla con
// "(#10) Viewer cannot access the provided Paid Message Account 1332495608860251".
// SOLO LECTURA: revisa la cuenta de WhatsApp de Multidigital (moneda, zona horaria, cuenta
// de pago principal, líneas de crédito) y si el token guardado puede ver esa cuenta de pago.
// No imprime el token ni manda mensajes.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-pago-waba-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const BUSINESS_ID = '2086696998860914'; // cartera Multidigital
const CUENTA_PAGO = '1332495608860251';
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function get(ruta, token) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, data: await res.json() };
}
const mostrar = (r) => console.log(r.ok ? JSON.stringify(r.data, null, 1) : `ERROR ${r.status}: ${limpiar(r.data?.error?.message)}`);

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre) || !e.whatsappToken || !e.whatsappWabaId) throw new Error('Falta la Empresa Multidigital con WhatsApp guardado.');
  const t = e.whatsappToken;

  console.log('[1] Cuenta de WhatsApp: moneda, zona horaria, cuenta de pago principal, estado');
  mostrar(await get(`${e.whatsappWabaId}?fields=name,currency,timezone_id,primary_funding_id,account_review_status,business_verification_status,health_status`, t));

  console.log('\n[2] Líneas de crédito asociadas a la cuenta de WhatsApp');
  mostrar(await get(`${e.whatsappWabaId}/extendedcredits`, t));

  console.log(`\n[3] ¿Puede este token ver la cuenta de pago ${CUENTA_PAGO}?`);
  mostrar(await get(`${CUENTA_PAGO}?fields=id`, t));

  console.log('\n[4] Cuentas de pago / líneas de crédito de la cartera Multidigital');
  mostrar(await get(`${BUSINESS_ID}/extendedcredits`, t));
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
