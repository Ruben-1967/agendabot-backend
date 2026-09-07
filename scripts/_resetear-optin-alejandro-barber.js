#!/usr/bin/env node
// Uso puntual (2026-09-07): resetea usaOptInMarketing a false para
// Alejandro Barber -- decisión del negocio de congelar marketing/opt-in
// para todos salvo LuxVision hasta tener claridad de precios (ver
// routes/empresa.js, PUT /opt-in-marketing ahora lo bloquea también).
// No toca compromisoSoloAgendamientoAceptadoEn -- se deja como estaba,
// es solo un registro histórico.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.update({
    where: { id: '18ba4ab2-17bd-4044-b6f7-2859917de126' }, // Alejandro Barber
    data: { usaOptInMarketing: false },
    select: { nombre: true, usaOptInMarketing: true },
  });
  console.log('Actualizado:', JSON.stringify(empresa));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
