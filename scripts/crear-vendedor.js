require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  const [, , nombre, email, password] = process.argv;
  if (!nombre || !email || !password) {
    console.error('Uso: node scripts/crear-vendedor.js "Nombre Apellido" "email@dominio.cl" "clave"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const vendedor = await prisma.vendedor.create({
    data: { nombre, email: email.toLowerCase().trim(), passwordHash, activo: true },
  });

  console.log(`Vendedor creado: ${vendedor.nombre} (${vendedor.email}) — id ${vendedor.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});