#!/usr/bin/env node
// Uso puntual: Meta aprobó las 2 plantillas con botones de Ahorróptica
// (confirmacion_cita_recordatorio_botones / confirmacion_cita_ultimo_aviso_botones,
// verificado con scripts/_ver-plantillas-ahoroptica-produccion.js -- ambas
// APPROVED el 2026-09-25). Se hizo el cutover real en
// jobs/confirmarCitasProximas.js (ahora usa las plantillas con botones y
// resuelve la confirmación por payload exacto, no por texto libre) --
// reactiva Empresa.recordatorioConfirmacionCitaActivo para Ahorróptica,
// que se había pausado el mismo día a pedido de Diego.
//
// USO (Shell de Render, producción):
//   node scripts/_reactivar-recordatorio-confirmacion-ahoroptica-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const empresa = await prisma.empresa.update({
    where: { id: EMPRESA_ID },
    data: { recordatorioConfirmacionCitaActivo: true },
  });
  console.log(`✅ recordatorioConfirmacionCitaActivo = true para ${empresa.nombre} (ahora con botones "Sí, confirmo"/"No puedo")`);

  const pendientes = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID, estado: 'PENDIENTE', confirmacionIntentos: { lte: 3 } },
    select: { id: true, fechaHoraInicio: true, confirmacionIntentos: true, confirmacionUltimoEnvioEn: true, nombrePaciente: true },
    orderBy: { fechaHoraInicio: 'asc' },
  });
  console.log(`\n${pendientes.length} cita(s) PENDIENTE(s) que retoman el ciclo automático (con botones) en la próxima corrida del job:\n`);
  for (const c of pendientes) {
    console.log(`- ${c.nombrePaciente || '(sin nombre)'} | ${c.fechaHoraInicio.toISOString()} | intentos=${c.confirmacionIntentos} | últ. envío=${c.confirmacionUltimoEnvioEn ? c.confirmacionUltimoEnvioEn.toISOString() : 'nunca'}`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
