#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: qué RubroTemplate tiene asignado el negocio
 * "Alejandro Barber".
 *
 * Uso (Shell de Render, producción): node scripts/_ver-rubro-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    include: { rubroTemplate: true },
  });

  if (!empresa) {
    console.log('No se encontró ninguna empresa con "Barber" en el nombre.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Empresa: ${empresa.nombre} (id=${empresa.id})`);
  console.log(`Rubro asignado: "${empresa.rubroTemplate.nombre}" (id=${empresa.rubroTemplate.id})`);
  console.log(`Modo de operación del rubro: ${empresa.rubroTemplate.modoOperacion}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
