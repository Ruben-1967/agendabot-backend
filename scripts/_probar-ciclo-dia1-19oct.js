#!/usr/bin/env node
// Prueba pura (sin base de datos, sin Flow, sin WhatsApp) de src/lib/cicloCobro.js:
// días de calendario (hora de Chile) hasta el próximo día 1. Fechas FIJAS.
//
// USO: node scripts/_probar-ciclo-dia1-19oct.js

const assert = require('node:assert/strict');
const { diasHastaProximoDia1 } = require('../src/lib/cicloCobro');

// Verano chileno (UTC-3) en octubre-marzo; invierno (UTC-4) abril-septiembre.
const casos = [
  // [descripción, instante UTC, días esperados]
  ['19-oct al mediodía (Chile) -> 1-nov', '2026-10-19T15:00:00Z', 13],
  ['31-oct (Chile) -> 1-nov', '2026-10-31T15:00:00Z', 1],
  ['1-nov mismo día -> 1-dic (30 días)', '2026-11-01T15:00:00Z', 30],
  ['15-dic -> 1-ene (cruce de año)', '2026-12-15T15:00:00Z', 17],
  ['31-dic -> 1-ene', '2026-12-31T15:00:00Z', 1],
  ['28-feb-2027 -> 1-mar (febrero corto)', '2027-02-28T15:00:00Z', 1],
  ['Chile aún en 18-oct (UTC ya 19-oct 02:00) -> 1-nov', '2026-10-19T02:00:00Z', 14],
  ['Chile ya en 1-nov (UTC 1-nov 03:30) -> 1-dic', '2026-11-01T03:30:00Z', 30],
];

for (const [descripcion, instante, esperado] of casos) {
  const real = diasHastaProximoDia1(new Date(instante));
  assert.equal(real, esperado, `${descripcion}: esperaba ${esperado}, dio ${real}`);
  console.log(`✅ ${descripcion}: ${real} días`);
}
console.log(`\n${casos.length} casos OK.`);
