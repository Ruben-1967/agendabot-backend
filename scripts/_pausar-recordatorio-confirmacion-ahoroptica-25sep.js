#!/usr/bin/env node
// Uso puntual: Diego (Ahorróptica) pidió explícitamente el 2026-09-25 que se
// detenga el envío de recordatorios de confirmación de cita, tras 2
// incidentes reales en 2 días con la confirmación por texto libre. Apaga
// Empresa.recordatorioConfirmacionCitaActivo SOLO para Ahorróptica -- el
// resto del bot (agendar, responder preguntas) sigue funcionando normal.
//
// Requiere haber corrido antes `npx prisma db push` en producción para que
// el campo recordatorioConfirmacionCitaActivo exista.
//
// USO (Shell de Render, producción):
//   node scripts/_pausar-recordatorio-confirmacion-ahoroptica-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const empresa = await prisma.empresa.update({
    where: { id: EMPRESA_ID },
    data: { recordatorioConfirmacionCitaActivo: false },
  });
  console.log(`✅ recordatorioConfirmacionCitaActivo = false para ${empresa.nombre}`);

  const pendientes = await prisma.cita.count({
    where: { empresaId: EMPRESA_ID, estado: 'PENDIENTE', confirmacionIntentos: { lte: 3 } },
  });
  console.log(`⚠️  ${pendientes} cita(s) PENDIENTE(s) que ya NO van a recibir más recordatorios ni liberarse automáticamente -- requieren gestión manual si el cliente no confirma por su cuenta.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
