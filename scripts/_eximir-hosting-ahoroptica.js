#!/usr/bin/env node
// Uso puntual (2026-09-07): marca exentoDeHosting=true para Ahorróptica,
// así "Suscribir plan" solo le cobra la mensualidad (el hosting anual ya
// lo pagó fuera del sistema). IMPORTANTE: es un flag simple, no "sáltate
// solo esta vez" -- hay que volver a ponerlo en false antes de
// fechaProximoCobroHosting (2027-08-05) para que ahí sí se le cobre.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const actualizado = await prisma.suscripcion.update({
    where: { empresaId: EMPRESA_ID },
    data: { exentoDeHosting: true },
    select: { exentoDeHosting: true, fechaProximoCobroHosting: true },
  });
  console.log('Actualizado:', JSON.stringify(actualizado));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
