require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const [, , email] = process.argv;
  if (!email) {
    console.error('Uso: node scripts/deshabilitar-vendedor.js "email@dominio.cl"');
    process.exit(1);
  }
  const vendedor = await prisma.vendedor.update({
    where: { email: email.toLowerCase().trim() },
    data: { activo: false },
  });
  console.log(`Vendedor deshabilitado: ${vendedor.nombre} (${vendedor.email})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});