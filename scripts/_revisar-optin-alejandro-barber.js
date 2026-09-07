#!/usr/bin/env node
// Uso puntual: revisa el valor real de usaOptInMarketing para la Empresa
// de Alejandro Barber -- el panel muestra la pestaña "Opt-in marketing"
// cuando esto es true. Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    select: {
      id: true, nombre: true, usaOptInMarketing: true,
      compromisoSoloAgendamientoAceptadoEn: true, creadoEn: true,
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
