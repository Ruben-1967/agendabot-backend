#!/usr/bin/env node
// Corre el chequeo diario UNA VEZ, ahora mismo, sin esperar a las 08:00 --
// para verificar que los 6 chequeos corren sin errores y (si corresponde)
// que la alerta por WhatsApp se manda bien. Los chequeos A-E son de solo
// lectura sobre los datos del sistema; el chequeo F además simula una
// conversación completa contra el negocio de demo (crea y borra una Cita
// de prueba con un teléfono fijo dedicado -- nunca toca datos de un
// cliente real). Manda un WhatsApp real a ALERTA_SALUD_TELEFONO SIEMPRE
// (haya o no problemas -- mismo comportamiento que el job real, sirve de
// "latido" diario).
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
