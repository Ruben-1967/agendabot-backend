#!/usr/bin/env node
/**
 * Script de diagnóstico (solo lectura): dado un número de WhatsApp
 * conectado (whatsappPhoneNumber, con o sin +), muestra exactamente qué
 * Empresa lo tiene asociado y qué servicios activos tiene cargados — para
 * detectar si el número quedó conectado a una Empresa distinta de la que
 * se está editando en el panel.
 *
 * Uso:
 *   node scripts/diagnosticar-servicios-empresa.js <numero>
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const numeroArg = process.argv[2];
if (!numeroArg) {
  console.error('Uso: node scripts/diagnosticar-servicios-empresa.js <numero>');
  process.exit(1);
}

const digitos = numeroArg.replace(/\D/g, '');

async function main() {
  console.log(`\nBuscando empresas cuyo whatsappPhoneNumber contenga "${digitos}"...\n`);

  const empresas = await prisma.empresa.findMany({
    where: { whatsappPhoneNumber: { contains: digitos } },
    include: {
      rubroTemplate: { select: { nombre: true, modoOperacion: true, serviciosBase: true } },
      servicios: { select: { id: true, nombre: true, activo: true } },
      usuarios: { select: { email: true, rol: true } },
    },
  });

  if (empresas.length === 0) {
    console.log('No se encontró ninguna Empresa con ese número. Revisá el formato (con o sin 56/+).');
    process.exit(0);
  }

  for (const e of empresas) {
    console.log('----------------------------------------');
    console.log(`Empresa: ${e.nombre}`);
    console.log(`  id: ${e.id}`);
    console.log(`  esDemo: ${e.esDemo}`);
    console.log(`  whatsappPhoneNumber: ${e.whatsappPhoneNumber}`);
    console.log(`  whatsappNumeroId: ${e.whatsappNumeroId}`);
    console.log(`  rubro: ${e.rubroTemplate?.nombre} (modo: ${e.rubroTemplate?.modoOperacion})`);
    console.log(`  usuarios: ${e.usuarios.map((u) => `${u.email} (${u.rol})`).join(', ') || '(ninguno)'}`);
    console.log(`  servicios cargados (${e.servicios.length}):`);
    if (e.servicios.length === 0) {
      console.log('    (ninguno — el bot usará el listado genérico del rubro)');
      console.log(`    Genérico del rubro: ${(e.rubroTemplate?.serviciosBase || []).map((s) => s.nombre || s).join(', ') || '(vacío)'}`);
    } else {
      e.servicios.forEach((s) => console.log(`    - ${s.nombre} (activo: ${s.activo})`));
    }
  }
  console.log('----------------------------------------\n');

  if (empresas.length > 1) {
    console.log('⚠️  ATENCIÓN: hay más de una Empresa con ese número — puede ser la causa del problema.\n');
  }
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
