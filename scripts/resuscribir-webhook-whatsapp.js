#!/usr/bin/env node
/**
 * Remediación puntual para empresas conectadas por Embedded Signup ANTES del
 * fix del 2026-08-31 en POST /empresa/whatsapp/conectar: ese endpoint nunca
 * suscribía la app a los webhooks de la WABA (se asumía, sin verificarlo,
 * que Embedded Signup lo hacía solo). Resultado real: el bot no recibía los
 * mensajes de negocios ya "conectados" según la base de datos — visto en
 * producción con Ahorróptica (+56 9 3615 4706).
 *
 * Este script no vuelve a pedir tokens a Meta: reutiliza el whatsappWabaId y
 * whatsappToken ya guardados (el token se descifra solo al leer, ver
 * src/lib/prisma.js) y solo ejecuta el paso de suscripción que faltó.
 *
 * Uso (en el Shell de Render, con las env vars de producción ya cargadas):
 *   EMPRESA_ID=<id> node scripts/resuscribir-webhook-whatsapp.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const GRAPH_API_VERSION = 'v21.0';
const empresaId = process.env.EMPRESA_ID;

if (!empresaId) {
  console.error('Uso: EMPRESA_ID=<id> node scripts/resuscribir-webhook-whatsapp.js');
  process.exit(1);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, nombre: true, whatsappWabaId: true, whatsappToken: true, whatsappPhoneNumber: true },
  });

  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  if (!empresa.whatsappWabaId || !empresa.whatsappToken) {
    console.error(`La empresa ${empresa.nombre} no tiene WhatsApp conectado (falta whatsappWabaId o whatsappToken).`);
    process.exit(1);
  }

  console.log(`Empresa: ${empresa.nombre} — número ${empresa.whatsappPhoneNumber} — WABA ${empresa.whatsappWabaId}`);
  console.log('Suscribiendo la app a los webhooks de la WABA...');

  const urlSuscripcion = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(empresa.whatsappWabaId)}/subscribed_apps`;
  const respuesta = await fetch(urlSuscripcion, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empresa.whatsappToken}` },
  });
  const datos = await respuesta.json();

  if (!respuesta.ok || !datos.success) {
    console.error('No se pudo suscribir la app a los webhooks de la WABA:', JSON.stringify(datos));
    process.exit(1);
  }

  console.log('Listo — la app ya está suscrita a los webhooks de esta WABA. El bot debería empezar a recibir mensajes.');
}

main()
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
