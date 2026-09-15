#!/usr/bin/env node
// Uso puntual, solo lectura: lista los Servicio reales activos de
// Ahorróptica -- para diagnosticar por qué el bot no reconoció
// "Evaluación examen visual" como un servicio válido (reportado 2026-09-15).
//
// USO (Shell de Render, producción):
//   node scripts/_ver-servicios-reales-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const servicios = await prisma.servicio.findMany({
    where: { empresaId: EMPRESA_ID },
    orderBy: { nombre: 'asc' },
  });

  console.log(`${servicios.length} servicio(s) para Ahorróptica:\n`);
  for (const s of servicios) {
    console.log(`- "${s.nombre}" (activo: ${s.activo}, id: ${s.id})`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
