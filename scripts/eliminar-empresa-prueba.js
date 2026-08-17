#!/usr/bin/env node
/**
 * Script de limpieza de datos de prueba: elimina por completo una Empresa
 * (y su Usuario, Suscripcion, y la DemoAsignada que la originó) para poder
 * rehacer el flujo de conversión + Embedded Signup desde cero con el mismo
 * número de teléfono.
 *
 * Uso (dry-run, no borra nada, solo muestra qué encontró):
 *   node scripts/eliminar-empresa-prueba.js 968974490
 *
 * Uso real (borra de verdad):
 *   node scripts/eliminar-empresa-prueba.js 968974490 --confirmar
 *
 * Pensado para correr en el Shell de Render del servicio correspondiente
 * (ya tiene el DATABASE_URL correcto cargado) — no se commitea el resultado,
 * es un script de una sola ejecución.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const numeroArg = process.argv[2];
const confirmar = process.argv.includes('--confirmar');

if (!numeroArg) {
  console.error('Uso: node scripts/eliminar-empresa-prueba.js <numero> [--confirmar]');
  process.exit(1);
}

// Acepta el número con o sin "56" adelante, normaliza al formato guardado en BD
const telefonoNormalizado = numeroArg.replace(/\D/g, '').replace(/^(?!56)/, '56');

async function main() {
  console.log(`\nBuscando datos asociados al número ${telefonoNormalizado}...\n`);

  const demo = await prisma.demoAsignada.findFirst({
    where: { OR: [{ telefono: telefonoNormalizado }, { telefonoOriginal: telefonoNormalizado }] },
    include: {
      empresaConvertida: {
        include: { usuarios: true, suscripcion: { include: { pagos: true } } },
      },
    },
  });

  if (!demo) {
    console.log('No se encontró ninguna DemoAsignada con ese número. Nada que borrar.');
    process.exit(0);
  }

  console.log('DemoAsignada encontrada:');
  console.log(`  id: ${demo.id}`);
  console.log(`  telefono: ${demo.telefono}`);
  console.log(`  convertidaEn: ${demo.convertidaEn}`);

  const empresa = demo.empresaConvertida;

  if (!empresa) {
    console.log('\nEsta demo no tiene una Empresa real asociada (nunca se convirtió, o ya se borró).');
    if (!confirmar) {
      console.log('\nPara borrar igual la DemoAsignada, corré de nuevo con --confirmar.');
      process.exit(0);
    }
  } else {
    console.log('\nEmpresa real asociada:');
    console.log(`  id: ${empresa.id}`);
    console.log(`  nombre: ${empresa.nombre}`);
    console.log(`  usuarios: ${empresa.usuarios.map((u) => u.email).join(', ') || '(ninguno)'}`);
    console.log(`  suscripcion: ${empresa.suscripcion ? `${empresa.suscripcion.plan} / ${empresa.suscripcion.estado}` : '(ninguna)'}`);
    console.log(`  pagos registrados: ${empresa.suscripcion?.pagos.length ?? 0}`);
  }

  if (!confirmar) {
    console.log('\n--- DRY RUN --- No se borró nada. Corré con --confirmar para borrar de verdad.\n');
    process.exit(0);
  }

  console.log('\nBorrando...');

  await prisma.$transaction(async (tx) => {
    if (empresa) {
      if (empresa.suscripcion) {
        await tx.pago.deleteMany({ where: { suscripcionId: empresa.suscripcion.id } });
        await tx.suscripcion.delete({ where: { id: empresa.suscripcion.id } });
      }
      await tx.usuario.deleteMany({ where: { empresaId: empresa.id } });
      await tx.empresa.delete({ where: { id: empresa.id } });
    }
    await tx.demoAsignada.delete({ where: { id: demo.id } });
  });

  console.log('\n✅ Listo. El número queda completamente libre para un flujo nuevo.\n');
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
