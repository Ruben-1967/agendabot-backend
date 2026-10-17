#!/usr/bin/env node
// Uso puntual (2026-10-17): el +56 9 6610 8858 figura "CONNECTED" en Meta, pero los
// mensajes que le escriben NO llegan a nuestro servidor y SÍ llegan al celular
// donde estaba antes ese número (el usuario lo confirmó). Es la misma falla que
// tuvo Alejandro Barber (2026-09-04): el número quedó agregado a la cuenta de
// WhatsApp pero nunca se REGISTRÓ en Cloud API (POST /{phone_number_id}/register
// con un PIN de 6 dígitos), así que WhatsApp sigue entregándolo a la app.
// Registrarlo lo traslada a la API y saca la sesión del celular.
//
// Usa el token que YA quedó guardado en la Empresa (no hay que pegarlo otra vez)
// y nunca lo imprime. El PIN se pide sin mostrarse: es uno nuevo de 6 dígitos que
// eliges tú (el número no tenía verificación en dos pasos); anótalo.
// No manda ningún mensaje.
//
// USO (Shell de Render, producción):
//   read -s -p "PIN nuevo de 6 digitos: " PIN; echo; export PIN
//   node scripts/_registrar-numero-multidigital-17oct.js
//   unset PIN

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const GRAPH = 'v21.0';
const PIN = (process.env.PIN || '').trim();
// TOKEN_REGISTRO (opcional): token de una app que sea de la MISMA cartera dueña de la
// cuenta de WhatsApp (Multidigital), solo para el registro. Con el token de
// "AgendaBot Producción" (app de otra cartera, Luxvision Chile) Meta rechaza el
// registro con (#10) aunque los permisos estén bien (verificado 2026-10-17).
const TOKEN_REGISTRO = (process.env.TOKEN_REGISTRO || '').replace(/\s+/g, '');

const limpiar = (txt) => String(txt || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function graph(ruta, token, opciones = {}) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) } });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function main() {
  if (!/^\d{6}$/.test(PIN)) throw new Error('PIN inválido: deben ser exactamente 6 dígitos (variable PIN).');
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  if (!e.whatsappNumeroId || !e.whatsappToken) throw new Error('La Empresa no tiene el WhatsApp guardado.');

  const antes = await graph(`${e.whatsappNumeroId}?fields=display_phone_number,status,is_pin_enabled,health_status`, e.whatsappToken);
  if (!antes.ok) throw new Error(`No se pudo consultar el número: ${limpiar(antes.data?.error?.message)}`);
  console.log(`Número: ${antes.data.display_phone_number} | status Meta: ${antes.data.status} | PIN activo: ${antes.data.is_pin_enabled}`);
  console.log('health_status ANTES:', JSON.stringify(antes.data.health_status));
  if (antes.data.is_pin_enabled) console.log('⚠️  El número ya tiene un PIN de verificación en dos pasos: el que escribas debe ser ESE mismo.');

  console.log('\nRegistrando el número en Cloud API (esto saca la sesión de WhatsApp del celular)...');
  const reg = await graph(`${e.whatsappNumeroId}/register`, e.whatsappToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: PIN }),
  });
  if (!reg.ok || !reg.data.success) {
    console.error('❌ No se pudo registrar:', limpiar(JSON.stringify(reg.data)));
    console.error('   Si dice que el número no está verificado, hay que pedir el código por llamada desde el administrador de WhatsApp de Meta y repetir.');
    process.exitCode = 1;
    return;
  }
  console.log('✅ Número registrado en Cloud API.');

  const despues = await graph(`${e.whatsappNumeroId}?fields=status,platform_type,health_status`, tokenParaRegistro);
  console.log('Estado DESPUÉS:', JSON.stringify(despues.data));
  console.log('\nAhora escríbele un mensaje al número desde otro teléfono y revisa los logs: [WEBHOOK WHATSAPP] mensaje entrante.');
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
