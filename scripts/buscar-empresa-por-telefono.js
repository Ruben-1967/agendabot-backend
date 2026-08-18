#!/usr/bin/env node
/**
 * Solo lectura: busca una Empresa por su telefonoContacto y muestra su id
 * (para armar links tipo /suscripcion/elegir-plan?empresaId=... cuando la
 * interfaz no muestra el id directamente).
 *
 * Uso (Render Shell):
 *   node scripts/buscar-empresa-por-telefono.js <telefono>
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const telefono = process.argv[2];
if (!telefono) {
  console.error('Uso: node scripts/buscar-empresa-por-telefono.js <telefono>');
  process.exit(1);
}

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { telefonoContacto: { contains: telefono } },
    select: {
      id: true,
      nombre: true,
      telefonoContacto: true,
      esDemo: true,
      suscripcion: { select: { plan: true, estado: true } },
    },
  });

  if (empresas.length === 0) {
    console.log(`No se encontró ninguna Empresa con teléfono que contenga "${telefono}".`);
    return;
  }

  console.log(`\n${empresas.length} empresa(s) encontrada(s):\n`);
  empresas.forEach((e) => {
    console.log(`- ${e.nombre} (${e.esDemo ? 'DEMO' : 'real'})`);
    console.log(`  id: ${e.id}`);
    console.log(`  teléfono: ${e.telefonoContacto}`);
    console.log(`  plan: ${e.suscripcion?.plan || 'sin suscripción'} — estado: ${e.suscripcion?.estado || '—'}`);
    console.log('');
  });
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
