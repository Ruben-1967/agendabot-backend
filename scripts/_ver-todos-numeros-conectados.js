#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: lista TODAS las empresas con un WhatsApp
 * conectado en la base — para confirmar si el número de prueba +56 9 2173
 * 8221 (verificado en Meta, WABA "Totemsystem Producción") sigue vinculado
 * a alguna Empresa, o quedó huérfano (nadie en la base lo tiene guardado).
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_ver-todos-numeros-conectados.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { whatsappNumeroId: { not: null } },
    select: { id: true, nombre: true, esDemo: true, whatsappNumeroId: true, whatsappWabaId: true, whatsappPhoneNumber: true },
    orderBy: { creadoEn: 'desc' },
  });

  console.log(`Empresas con whatsappNumeroId no nulo: ${empresas.length}\n`);
  empresas.forEach((e) => {
    console.log(`- id=${e.id} nombre="${e.nombre}" esDemo=${e.esDemo} numero=${e.whatsappPhoneNumber} numeroId=${e.whatsappNumeroId} wabaId=${e.whatsappWabaId}`);
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
