#!/usr/bin/env node
// Uso puntual: lista todas las Empresa con usaOptInMarketing=true, para
// saber a quién afectaría resetear el default a "No" (excepto LuxVision).
// Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { usaOptInMarketing: true },
    select: { id: true, nombre: true, usaOptInMarketing: true, compromisoSoloAgendamientoAceptadoEn: true },
  });
  console.log(`Empresas con usaOptInMarketing=true: ${empresas.length}`);
  console.log(JSON.stringify(empresas, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
