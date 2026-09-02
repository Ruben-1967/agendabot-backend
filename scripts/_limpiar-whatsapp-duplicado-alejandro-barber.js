#!/usr/bin/env node
/**
 * Limpia los campos de WhatsApp de la empresa "Alejandro Barber" DUPLICADA
 * y vacía (8f583c44-6ff9-4e52-aa92-820a0c199a45) donde quedó conectado por
 * error el +56949528788 — la cuenta real (con usuario y servicios) es
 * 18ba4ab2-17bd-4044-b6f7-2859917de126. Necesario porque whatsappNumeroId
 * es único: no se puede conectar el mismo número a la cuenta correcta
 * mientras siga asignado acá.
 *
 * Uso (Render Shell): node scripts/_limpiar-whatsapp-duplicado-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_VACIA = '8f583c44-6ff9-4e52-aa92-820a0c199a45';

async function main() {
  const antes = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID_VACIA },
    select: { nombre: true, whatsappPhoneNumber: true },
  });
  console.log('Antes:', antes.nombre, '->', antes.whatsappPhoneNumber || '(sin conectar)');

  await prisma.empresa.update({
    where: { id: EMPRESA_ID_VACIA },
    data: { whatsappNumeroId: null, whatsappToken: null, whatsappWabaId: null, whatsappPhoneNumber: null },
  });

  console.log('Listo — WhatsApp desvinculado de la empresa duplicada. Ahora corre de nuevo conectar-whatsapp-manual.js con EMPRESA_ID=18ba4ab2-17bd-4044-b6f7-2859917de126.');
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); }).finally(() => prisma.$disconnect());
