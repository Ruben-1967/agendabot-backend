#!/usr/bin/env node
// Uso puntual (2026-10-17): registrar el +56 9 6610 8858 en Cloud API falla con
// "(#10) Application does not have permission ... for account 56966108858@s.whatsapp.net"
// aunque el token SÍ tiene los permisos (whatsapp_business_management y
// whatsapp_business_messaging, verificado con debug_token) y los mensajes siguen
// llegando al celular: la sesión de la app es más reciente que la de la API, y Meta
// no deja que la API tome el número sin que su dueño lo VERIFIQUE de nuevo. Este
// script hace la verificación por LLAMADA (el celular con esa SIM recibe llamadas)
// y después el registro, en dos pasos. Usa el token guardado en la Empresa (nunca
// se imprime). No manda mensajes de WhatsApp.
//
// USO (Shell de Render, producción):
//   Paso A -- Meta LLAMA al número y dicta un código de 6 dígitos:
//     ACCION=pedir node scripts/_verificar-y-registrar-numero-multidigital-17oct.js
//   Paso B -- con ese código y un PIN nuevo de 6 dígitos (anótalo):
//     ACCION=verificar CODIGO=NNNNNN PIN=NNNNNN node scripts/_verificar-y-registrar-numero-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const GRAPH = 'v21.0';
const ACCION = (process.env.ACCION || '').trim();
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function post(ruta, token, cuerpo) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { ok: res.ok, data: await res.json() };
}

async function main() {
  if (!['pedir', 'verificar'].includes(ACCION)) throw new Error('Falta ACCION=pedir o ACCION=verificar.');
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  if (!e.whatsappNumeroId || !e.whatsappToken) throw new Error('La Empresa no tiene el WhatsApp guardado.');

  if (ACCION === 'pedir') {
    console.log(`Pidiendo a Meta que LLAME a ${e.whatsappPhoneNumber} con el código de verificación...`);
    const r = await post(`${e.whatsappNumeroId}/request_code`, e.whatsappToken, { code_method: 'VOICE', language: 'es' });
    if (!r.ok || !r.data.success) throw new Error(`No se pudo pedir el código: ${limpiar(JSON.stringify(r.data))}`);
    console.log('✅ Meta va a llamar al número en unos segundos. Anota el código de 6 dígitos que dicte la voz y corre el Paso B.');
    return;
  }

  const codigo = (process.env.CODIGO || '').replace(/\D/g, '');
  const pin = (process.env.PIN || '').trim();
  if (!/^\d{6}$/.test(codigo)) throw new Error('CODIGO inválido: deben ser 6 dígitos (el que dictó la llamada).');
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN inválido: deben ser 6 dígitos.');

  console.log('Verificando el código con Meta...');
  const v = await post(`${e.whatsappNumeroId}/verify_code`, e.whatsappToken, { code: codigo });
  if (!v.ok || !v.data.success) throw new Error(`Código rechazado: ${limpiar(JSON.stringify(v.data))}`);
  console.log('✅ Código verificado.');

  console.log('Registrando el número en Cloud API (esto saca la sesión de WhatsApp del celular)...');
  const r = await post(`${e.whatsappNumeroId}/register`, e.whatsappToken, { messaging_product: 'whatsapp', pin });
  if (!r.ok || !r.data.success) throw new Error(`No se pudo registrar: ${limpiar(JSON.stringify(r.data))}`);
  console.log('✅ Número registrado en Cloud API.');
  console.log('\nAhora escríbele al número desde otro teléfono y revisa los logs: [WEBHOOK WHATSAPP] mensaje entrante.');
}

main()
  .catch((err) => { console.error('❌', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
