#!/usr/bin/env node
// Uso puntual: busca la Cita con el envío de confirmación/recordatorio más
// antiguo registrado (confirmacionUltimoEnvioEn) -- para identificar cuál
// cita disparó el primer mensaje de categoría Utilidad (plantillas
// confirmacion_cita_recordatorio / confirmacion_cita_ultimo_aviso, ver
// src/jobs/confirmarCitasProximas.js) que motivó el correo de felicitación
// de Meta. Solo lectura.
//
// Nota: confirmacionUltimoEnvioEn se sobrescribe en cada intento (1, 2, 3)
// de la MISMA cita -- si esa cita ya pasó por más de un intento, esta
// fecha es la del último, no la del primero. Igual sirve para identificar
// la cita y el cliente.
//
// USO (Shell de Render, backend de producción):
//   node scripts/_ver-primer-envio-confirmacion-cita.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const cita = await prisma.cita.findFirst({
    where: { confirmacionUltimoEnvioEn: { not: null } },
    orderBy: { confirmacionUltimoEnvioEn: 'asc' },
    include: { cliente: true, empresa: true, servicio: true },
  });

  if (!cita) {
    console.log('No hay ninguna Cita con confirmacionUltimoEnvioEn registrado todavía.');
    return;
  }

  console.log('\nPrimer envío de confirmación de cita registrado:\n');
  console.log(`Empresa:              ${cita.empresa.nombre}`);
  console.log(`Cliente:              ${cita.cliente.nombre || '(sin nombre)'}`);
  console.log(`Teléfono:             ${cita.cliente.telefono}`);
  console.log(`Servicio:             ${cita.servicio?.nombre || '(sin servicio)'}`);
  console.log(`Fecha/hora de la cita: ${cita.fechaHoraInicio}`);
  console.log(`Intentos de confirmación: ${cita.confirmacionIntentos}`);
  console.log(`Último envío:          ${cita.confirmacionUltimoEnvioEn}`);
  console.log(`Estado actual:         ${cita.estado}`);
  console.log(`Plantilla usada:       ${cita.confirmacionIntentos >= 3 ? 'confirmacion_cita_ultimo_aviso' : 'confirmacion_cita_recordatorio'}`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
