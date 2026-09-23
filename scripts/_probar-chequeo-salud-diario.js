#!/usr/bin/env node
// Corre el chequeo diario UNA VEZ, ahora mismo, sin esperar a las 08:00 --
// para verificar que los 4 chequeos corren sin errores y (si corresponde)
// que la alerta por WhatsApp se manda bien. Solo lectura sobre los datos
// del sistema; si hay algo que reportar, SÍ manda un WhatsApp real a
// ALERTA_SALUD_TELEFONO (mismo comportamiento que el job real).
//
// USO (Shell de Render):
//   node scripts/_probar-chequeo-salud-diario.js

require('dotenv').config();
const { ejecutarChequeoSaludDiario } = require('../src/jobs/chequeoSaludDiario');
const prisma = require('../src/lib/prisma');

ejecutarChequeoSaludDiario()
  .then(() => console.log('\nListo -- revisa el detalle impreso arriba.'))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
