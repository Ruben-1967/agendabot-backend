#!/usr/bin/env node
/**
 * URGENTE: desconecta a Alejandro Barber del número +56 9 2173 8221 —
 * resultó ser el número real de otro negocio del usuario (Ohparis.cl,
 * e-commerce administrado por Chizi AI), no un número de prueba libre.
 * Ambos bots estaban respondiendo en paralelo sobre el mismo número.
 *
 * Limpia whatsappNumeroId/whatsappToken/whatsappWabaId/whatsappPhoneNumber
 * de la Empresa — no toca ningún otro dato ni ninguna otra empresa.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_desconectar-whatsapp-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = '18ba4ab2-17bd-4044-b6f7-2859917de126'; // Alejandro Barber

async function main() {
  const antes = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, whatsappNumeroId: true, whatsappPhoneNumber: true, whatsappWabaId: true },
  });
  if (!antes) {
    console.log('No se encontró la empresa.');
    await prisma.$disconnect();
    return;
  }
  console.log('Antes:', antes);

  const despues = await prisma.empresa.update({
    where: { id: EMPRESA_ID },
    data: { whatsappNumeroId: null, whatsappToken: null, whatsappWabaId: null, whatsappPhoneNumber: null },
    select: { nombre: true, whatsappNumeroId: true, whatsappPhoneNumber: true, whatsappWabaId: true },
  });
  console.log('\nDespués:', despues);
  console.log('\nAlejandro Barber quedó sin WhatsApp conectado — el número +56 9 2173 8221 queda libre para Ohparis.cl/Chizi AI.');

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
