#!/usr/bin/env node
// Uso puntual: confirma el estado del usuario de LuxVision tras la
// migración (nunca imprime el passwordHash). Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const usuario = await prisma.usuario.findFirst({
    where: { email: { equals: 'contacto@luxvision.cl', mode: 'insensitive' } },
    select: {
      id: true, email: true, nombre: true, rol: true, empresaId: true,
      tokenActivacion: true, tokenActivacionExpira: true, fechaActivacionCuenta: true,
      creadoEn: true,
    },
  });
  console.log(JSON.stringify(usuario, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
