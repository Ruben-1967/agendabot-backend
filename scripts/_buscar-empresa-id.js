#!/usr/bin/env node
// Uso puntual: para cada Empresa cuyo nombre contiene "Luxvision", imprime
// su id, cuántos Usuario tiene, cuántos Cliente tiene, y el email de sus
// usuarios -- para desempatar entre duplicados y confirmar cuál es la
// empresa real que usa el cliente (solo lectura, no toca nada).
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Luxvision', mode: 'insensitive' } },
    select: {
      id: true,
      nombre: true,
      usuarios: { select: { email: true, nombre: true } },
      _count: { select: { clientes: true } },
    },
  });
  console.log(JSON.stringify(empresas, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
