#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: solo el id de la Empresa "Alejandro Barber"
 * y su estado actual de WhatsApp — necesario para correr
 * conectar-whatsapp-manual.js (Plan B) con el nuevo número +56963431866.
 *
 * Uso (Render Shell): node scripts/_ver-empresaid-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    select: {
      id: true,
      nombre: true,
      whatsappNumeroId: true,
      whatsappWabaId: true,
      whatsappPhoneNumber: true,
    },
  });

  if (!empresa) {
    console.log('No se encontró ninguna empresa con "Barber" en el nombre.');
    return;
  }

  console.log('Empresa:', empresa.nombre);
  console.log('  id (EMPRESA_ID):', empresa.id);
  console.log('  WhatsApp conectado actualmente:', empresa.whatsappPhoneNumber || '(ninguno)');
  console.log('  whatsappNumeroId:', empresa.whatsappNumeroId || '(vacío)');
  console.log('  whatsappWabaId:', empresa.whatsappWabaId || '(vacío)');
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
