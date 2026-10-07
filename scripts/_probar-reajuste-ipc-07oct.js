#!/usr/bin/env node
// Prueba (2026-10-07) de la lógica pura del recordatorio de reajuste anual por
// IPC (src/lib/reajusteIPC.js). No usa base de datos ni WhatsApp: solo fechas
// fijas. USO: node scripts/_probar-reajuste-ipc-07oct.js

const { suscripcionesParaAvisoReajuste } = require('../src/lib/reajusteIPC');

const d = (iso) => new Date(`${iso}T12:00:00Z`);
let fallos = 0;

function caso(descripcion, activacion, hoy, esperaAviso, esperaDias) {
  const r = suscripcionesParaAvisoReajuste([{ empresaNombre: 'X', fechaActivacion: d(activacion) }], d(hoy));
  const avisa = r.length === 1;
  const diasOk = !esperaAviso || r[0].dias === esperaDias;
  const ok = avisa === esperaAviso && diasOk;
  if (!ok) fallos++;
  console.log(`${ok ? '✅' : '❌'} ${descripcion} -- avisa=${avisa}${avisa ? ` (faltan ${r[0].dias} días)` : ''}`);
}

caso('40 días antes del primer aniversario', '2026-10-20', '2027-09-10', true, 40);
caso('justo 45 días antes (límite superior)', '2026-10-20', '2027-09-05', true, 45);
caso('46 días antes (aún muy temprano)', '2026-10-20', '2027-09-04', false);
caso('justo 30 días antes (límite inferior)', '2026-10-20', '2027-09-20', true, 30);
caso('29 días antes (ya no alcanza el plazo, no avisa)', '2026-10-20', '2027-09-21', false);
caso('19 días antes (tarde)', '2026-10-20', '2027-10-01', false);
caso('recién activada: no hay aviso en el primer año', '2026-10-20', '2026-12-01', false);
caso('cruce de año (activada en enero, aviso en diciembre)', '2026-01-10', '2026-12-01', true, 40);
caso('segundo aniversario también avisa', '2026-10-20', '2028-09-10', true, 40);
caso('29-feb: aniversario cae al 28-feb', '2024-02-29', '2027-01-15', true, 44);

const sinFecha = suscripcionesParaAvisoReajuste([{ empresaNombre: 'Y', fechaActivacion: null }], d('2027-09-10'));
const okSinFecha = sinFecha.length === 0;
if (!okSinFecha) fallos++;
console.log(`${okSinFecha ? '✅' : '❌'} sin fecha de activación: se ignora`);

console.log(fallos === 0 ? '\nTodo OK.' : `\n${fallos} caso(s) fallaron.`);
process.exitCode = fallos === 0 ? 0 : 1;
