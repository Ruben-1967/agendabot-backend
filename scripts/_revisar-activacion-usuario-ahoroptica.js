#!/usr/bin/env node
// Uso puntual: revisa fechaActivacionCuenta del/los Usuario de Ahorróptica,
// para saber si el nuevo aviso de pago pendiente les va a aparecer en rojo
// de inmediato. Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const usuarios = await prisma.usuario.findMany({
    where: { empresaId: 'ahoroptica-lautaro-seed-id' },
    select: { id: true, nombre: true, email: true, rol: true, fechaActivacionCuenta: true, creadoEn: true },
  });
  console.log(JSON.stringify(usuarios, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
