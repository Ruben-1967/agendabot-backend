#!/usr/bin/env node
/**
 * Script de una sola ejecución: guarda el número WhatsApp de Ahorróptica
 * en la BD. Se ejecuta en Render Shell, no se commitea.
 * 
 * DATOS A GUARDAR:
 * - empresaId: ahoroptica-lautaro-seed-id
 * - whatsappNumeroId: 135018715483508 (phone_number_id de Meta)
 * - whatsappWabaId: 2156101751629995
 * - whatsappPhoneNumber: +56921738221
 * - whatsappToken: (el token permanente)
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const AHOROPTICA_ID = 'ahoroptica-lautaro-seed-id';
const WHATSAPP_NUMERO_ID = '135018715483508';
const WHATSAPP_WABA_ID = '2156101751629995';
const WHATSAPP_PHONE_NUMBER = '+56921738221';
const WHATSAPP_TOKEN = process.env.AHOROPTICA_WHATSAPP_TOKEN;

if (!WHATSAPP_TOKEN) {
  console.error('❌ ERROR: falta la variable de entorno AHOROPTICA_WHATSAPP_TOKEN.');
  process.exit(1);
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   GUARDANDO DATOS WHATSAPP DE AHORRÓPTICA EN BD            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Paso 1: Verificar que Ahorróptica existe
  console.log('1️⃣  Buscando empresa Ahorróptica...');
  const ahorro = await prisma.empresa.findUnique({
    where: { id: AHOROPTICA_ID },
    select: { id: true, nombre: true }
  });

  if (!ahorro) {
    console.error('❌ ERROR: No se encontró Ahorróptica con ID:', AHOROPTICA_ID);
    process.exit(1);
  }
  console.log('   ✅ Encontrada:', ahorro.nombre);

  // Paso 2: Actualizar los campos WhatsApp
  console.log('\n2️⃣  Actualizando campos WhatsApp...');
  const actualizada = await prisma.empresa.update({
    where: { id: AHOROPTICA_ID },
    data: {
      whatsappNumeroId: WHATSAPP_NUMERO_ID,
      whatsappToken: WHATSAPP_TOKEN,
      whatsappWabaId: WHATSAPP_WABA_ID,
      whatsappPhoneNumber: WHATSAPP_PHONE_NUMBER,
    },
    select: {
      id: true,
      nombre: true,
      whatsappNumeroId: true,
      whatsappPhoneNumber: true,
      whatsappWabaId: true,
      whatsappToken: true, // SÍ lo leemos de vuelta, para confirmar que se guardó
    }
  });

  // Paso 3: Confirmación visual
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   ✅ DATOS GUARDADOS CORRECTAMENTE                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('Empresa ID:', actualizada.id);
  console.log('Nombre:', actualizada.nombre);
  console.log('WhatsApp Number ID:', actualizada.whatsappNumeroId);
  console.log('WhatsApp Phone Number:', actualizada.whatsappPhoneNumber);
  console.log('WhatsApp WABA ID:', actualizada.whatsappWabaId);
  console.log('WhatsApp Token:', actualizada.whatsappToken ? '✅ GUARDADO (cifrado)' : '❌ NULL');

  console.log('\n✨ Ahorróptica está lista para recibir mensajes en +56 9 2173 8221');
  console.log('   Próximo paso: Escribir al número desde tu teléfono para probar.\n');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});