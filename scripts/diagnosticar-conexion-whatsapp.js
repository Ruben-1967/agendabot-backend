#!/usr/bin/env node
/**
 * Solo lectura: muestra el estado de conexión de WhatsApp de una Empresa
 * (whatsappNumeroId, si tiene whatsappToken guardado, y cuándo se actualizó
 * por última vez) — para diagnosticar por qué un mensaje entrante no gatilló
 * respuesta del bot después de una reconexión (ej. Coexistence).
 *
 * Uso (Render Shell):
 *   node scripts/diagnosticar-conexion-whatsapp.js <texto a buscar en el nombre>
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const busqueda = process.argv[2];
if (!busqueda) {
  console.error('Uso: node scripts/diagnosticar-conexion-whatsapp.js <texto a buscar en el nombre>');
  process.exit(1);
}

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: busqueda, mode: 'insensitive' } },
    select: {
      id: true,
      nombre: true,
      esDemo: true,
      whatsappNumeroId: true,
      whatsappToken: true,
      whatsappWabaId: true,
      whatsappPhoneNumber: true,
      telefonoContacto: true,
    },
  });

  if (empresas.length === 0) {
    console.log(`No se encontró ninguna Empresa cuyo nombre contenga "${busqueda}".`);
    return;
  }

  console.log(`\n${empresas.length} empresa(s) encontrada(s):\n`);
  empresas.forEach((e) => {
    console.log(`- ${e.nombre} (${e.esDemo ? 'DEMO' : 'real'})`);
    console.log(`  id: ${e.id}`);
    console.log(`  whatsappNumeroId (phone_number_id de Meta): ${e.whatsappNumeroId || '(vacío)'}`);
    console.log(`  whatsappToken guardado: ${e.whatsappToken ? 'sí' : 'NO'}`);
    console.log(`  whatsappWabaId: ${e.whatsappWabaId || '(vacío)'}`);
    console.log(`  whatsappPhoneNumber: ${e.whatsappPhoneNumber || '(vacío)'}`);
    console.log(`  telefonoContacto: ${e.telefonoContacto || '(vacío)'}`);
    console.log('');
  });

  console.log('Con el "phone_number_id" de arriba puedes confirmar en developers.facebook.com');
  console.log('> tu App > WhatsApp > Configuración de la API si coincide con el número recién conectado.');
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
