#!/usr/bin/env node
/**
 * Plan B de conexión de WhatsApp (ver análisis "Embedded Signup v4 /
 * Coexistence" del 2026-08-28): para cuando el flujo de Embedded Signup
 * está roto del lado de Meta, conecta un cliente nuevo manualmente,
 * partiendo de una WABA/número ya vinculados a mano en el dashboard de
 * Meta (business.facebook.com), sin pasar por el "code" de OAuth que
 * solo entrega FB.login().
 *
 * Este script NO toca ni reemplaza POST /empresa/whatsapp/conectar — hace
 * el mismo trabajo (resolver/confirmar el número, guardar en la BD) más
 * un paso que Embedded Signup automatiza y el flujo manual no: suscribir
 * la app a los webhooks de la WABA (sin esto, Meta nunca avisa al backend
 * que llegó un mensaje).
 *
 * Requisitos previos (manuales, en business.facebook.com):
 *   1. La WABA/número del cliente ya debe existir y estar conectado.
 *   2. El System User de AgendaBot (Business Manager del Tech Provider)
 *      debe tener activos asignados sobre esa WABA ("Asignar activos").
 *   3. Generar ahí mismo un token del System User con permisos
 *      whatsapp_business_management y whatsapp_business_messaging.
 *
 * Uso:
 *   EMPRESA_ID=<id> WABA_ID=<waba_id> ACCESS_TOKEN=<token> \
 *     node scripts/conectar-whatsapp-manual.js
 *
 *   PHONE_NUMBER_ID es opcional — si se omite, se resuelve automáticamente
 *   (falla si la WABA tiene más de un número).
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const GRAPH_API_VERSION = 'v21.0';

const empresaId = process.env.EMPRESA_ID;
const wabaId = process.env.WABA_ID;
const accessToken = process.env.ACCESS_TOKEN;
let phoneNumberId = process.env.PHONE_NUMBER_ID;

if (!empresaId || !wabaId || !accessToken) {
  console.error('Uso: EMPRESA_ID=<id> WABA_ID=<waba_id> ACCESS_TOKEN=<token> [PHONE_NUMBER_ID=<id>] node scripts/conectar-whatsapp-manual.js');
  process.exit(1);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  console.log('Empresa encontrada:', empresa.nombre);

  if (!phoneNumberId) {
    console.log('PHONE_NUMBER_ID no entregado, resolviendo desde la WABA...');
    const urlNumerosWaba = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`;
    const respuestaNumeros = await fetch(urlNumerosWaba);
    const datosNumeros = await respuestaNumeros.json();

    if (!respuestaNumeros.ok || !Array.isArray(datosNumeros.data)) {
      console.error('Error al listar phone_numbers de la WABA:', JSON.stringify(datosNumeros));
      process.exit(1);
    }
    if (datosNumeros.data.length !== 1) {
      console.error(`La WABA ${wabaId} tiene ${datosNumeros.data.length} números, se esperaba exactamente 1:`, JSON.stringify(datosNumeros.data));
      process.exit(1);
    }
    phoneNumberId = datosNumeros.data[0].id;
    console.log('phoneNumberId resuelto:', phoneNumberId);
  }

  console.log('Confirmando el número con Meta...');
  const urlNumero = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
  const respuestaNumero = await fetch(urlNumero, { headers: { Authorization: `Bearer ${accessToken}` } });
  const datosNumero = await respuestaNumero.json();

  if (!respuestaNumero.ok || !datosNumero.display_phone_number) {
    console.error('No se pudo confirmar el número de WhatsApp con Meta:', JSON.stringify(datosNumero));
    process.exit(1);
  }
  console.log('Número confirmado:', datosNumero.display_phone_number, `(${datosNumero.verified_name || 'sin nombre verificado'})`);

  console.log('Suscribiendo la app a los webhooks de la WABA...');
  const urlSuscripcion = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  const respuestaSuscripcion = await fetch(urlSuscripcion, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const datosSuscripcion = await respuestaSuscripcion.json();

  if (!respuestaSuscripcion.ok || !datosSuscripcion.success) {
    console.error('No se pudo suscribir la app a los webhooks de la WABA:', JSON.stringify(datosSuscripcion));
    process.exit(1);
  }
  console.log('App suscrita a los webhooks de la WABA correctamente.');

  const empresaActualizada = await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      whatsappNumeroId: phoneNumberId,
      whatsappToken: accessToken,
      whatsappWabaId: wabaId,
      whatsappPhoneNumber: datosNumero.display_phone_number,
    },
    select: {
      id: true,
      nombre: true,
      whatsappNumeroId: true,
      whatsappWabaId: true,
      whatsappPhoneNumber: true,
    },
  });

  console.log('\nWhatsApp conectado manualmente para empresa', empresaActualizada.id, `(${empresaActualizada.nombre}):`, empresaActualizada.whatsappPhoneNumber);
}

main()
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
