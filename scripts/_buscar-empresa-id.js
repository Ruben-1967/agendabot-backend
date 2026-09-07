#!/usr/bin/env node
// Uso puntual: revisa el estado de Suscripcion de las 2 Empresa candidatas
// de LuxVision antes de decidir cómo unificarlas. Solo lectura, no toca nada.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const IDS = [
  'deba7912-6a28-44ae-8e06-d5bae0a7c1aa', // Luxvision EIRL -- login, sin WhatsApp, sin pacientes
  'e277ea9e-5793-468c-aa96-e4a2f7457201', // Luxvision -- WhatsApp real + 1903 pacientes, sin login
];

async function main() {
  for (const empresaId of IDS) {
    const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });
    console.log(empresaId, '->', JSON.stringify(suscripcion));
  }
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
