#!/usr/bin/env node
// Uso puntual: revisa si Ahorróptica tiene una Suscripcion asociada (la
// pestaña "Clientes" del panel de vendedores lista desde Suscripcion, no
// desde Empresa directo). Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Ahorróptica', mode: 'insensitive' } },
    select: {
      id: true, nombre: true, esDemo: true, vendedorId: true, creadoEn: true,
      suscripcion: true,
    },
  });
  console.log(JSON.stringify(empresa, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
