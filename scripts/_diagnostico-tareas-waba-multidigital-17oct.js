#!/usr/bin/env node
// Uso puntual (2026-10-17): el registro del +56 9 6610 8858 sigue rechazado con
// "(#10) Application does not have permission" aunque el token tiene los permisos
// correctos y Meta dice que el número ya está verificado. SOLO LECTURA: revisa qué
// TAREAS (permisos finos) tiene cada usuario sobre la cuenta de WhatsApp de
// Multidigital y quién es el dueño de la cuenta. Registrar un número exige poder
// "gestionar" la cuenta; si el usuario del sistema solo quedó con acceso parcial,
// lo veremos acá. No imprime el token ni manda mensajes.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-tareas-waba-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const BUSINESS_ID = '2086696998860914'; // cartera Multidigital
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function get(ruta, token) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre) || !e.whatsappToken || !e.whatsappWabaId) throw new Error('Falta la Empresa Multidigital con WhatsApp guardado.');

  console.log('[1] Quién es el dueño de la cuenta de WhatsApp');
  const w = await get(`${e.whatsappWabaId}?fields=name,owner_business_info,on_behalf_of_business_info,account_review_status`, e.whatsappToken);
  console.log(w.ok ? JSON.stringify(w.data, null, 1) : `ERROR ${w.status}: ${limpiar(w.data?.error?.message)}`);

  console.log('\n[2] Usuarios asignados a la cuenta y sus tareas');
  const u = await get(`${e.whatsappWabaId}/assigned_users?business=${BUSINESS_ID}&fields=id,name,user_type,tasks`, e.whatsappToken);
  console.log(u.ok ? JSON.stringify(u.data, null, 1) : `ERROR ${u.status}: ${limpiar(u.data?.error?.message)}`);

  console.log('\n[3] Quién es el usuario dueño del token');
  const yo = await get('me?fields=id,name', e.whatsappToken);
  console.log(yo.ok ? JSON.stringify(yo.data) : `ERROR ${yo.status}: ${limpiar(yo.data?.error?.message)}`);
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
