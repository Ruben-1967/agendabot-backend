#!/usr/bin/env node
/**
 * Genera un link de activación para un Usuario que YA EXISTE (a diferencia
 * del flujo normal, que solo genera este link al convertir una demo nueva).
 * Pensado para negocios que ya estaban cargados en el sistema antes de que
 * existiera ese flujo (ej. Ahorróptica) y necesitan definir su propia
 * contraseña por primera vez, reemplazando una temporal que solo conocía
 * quien la cargó.
 *
 * Al usar el link, el negocio define su contraseña y la temporal deja de
 * servir — no hace falta invalidarla a mano, /activar-cuenta la reemplaza.
 *
 * Uso:
 *   node scripts/generar-link-activacion-existente.js contacto@ahorroptica.cl
 */

require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { obtenerUrlPanelPrincipal } = require('../src/lib/urlPanel');

const email = process.argv[2];
if (!email) {
  console.error('Uso: node scripts/generar-link-activacion-existente.js <email>');
  process.exit(1);
}

async function main() {
  const usuario = await prisma.usuario.findUnique({
    where: { email },
    include: { empresa: { select: { nombre: true } } },
  });

  if (!usuario) {
    console.error(`No se encontró ningún usuario con el email ${email}`);
    process.exit(1);
  }

  console.log(`\nUsuario encontrado: ${usuario.nombre} (${usuario.email}) — empresa: ${usuario.empresa.nombre}\n`);

  const tokenActivacion = crypto.randomBytes(24).toString('hex');
  const tokenActivacionExpira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { tokenActivacion, tokenActivacionExpira },
  });

  const link = `${obtenerUrlPanelPrincipal()}/activar-cuenta?token=${tokenActivacion}`;

  console.log('✅ Link de activación generado (válido 7 días):\n');
  console.log(link);
  console.log('\nAl entrar y definir su contraseña, la reemplaza automáticamente — no hace falta borrar la anterior.\n');
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
