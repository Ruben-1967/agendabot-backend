#!/usr/bin/env node
// Pruebas de src/lib/uf.js. La parte del parser usa un trozo FIJO de la tabla del SII
// (sin red). Con LIVE=1 además consulta el SII real para una fecha dada (solo lectura,
// no escribe nada ni cobra nada).
//
// USO: node scripts/_probar-uf-sii-19oct.js
//      LIVE=1 node scripts/_probar-uf-sii-19oct.js

const assert = require('node:assert/strict');
const { parsearUfSii, obtenerValorUfHoy } = require('../src/lib/uf');

// Trozo de https://www.sii.cl/valores_y_fechas/uf/uf2026.htm (filas 19 y 31; meses sin dato vacíos).
const fila = (dia, valores) => `<tr>\n   <th style='text-align:center;'>${dia}</th>\n${valores.map((v) => `   <td style='text-align:right;'>${v}</td>`).join('\n')}\n</tr>`;
const HTML = [
  fila(19, ['39.736,85', '39.739,61', '39.841,72', '39.974,09', '40.408,15', '40.790,42', '40.844,79', '40.857,96', '40.967,24', '41.183,94', '&nbsp;', '&nbsp;']),
  fila(31, ['39.800,00', '&nbsp;', '39.900,00', '40.000,00', '40.500,00', '&nbsp;', '40.900,00', '41.000,00', '&nbsp;', '41.300,00', '&nbsp;', '&nbsp;']),
].join('\n');

assert.equal(parsearUfSii(HTML, 19, 10), 41183.94);
console.log('✅ parser: 19-oct = 41183,94');
assert.equal(parsearUfSii(HTML, 19, 1), 39736.85);
console.log('✅ parser: 19-ene = 39736,85 (otro mes, misma fila)');
assert.equal(parsearUfSii(HTML, 19, 11), null);
console.log('✅ parser: 19-nov (aún sin valor) = null, no inventa nada');
assert.equal(parsearUfSii(HTML, 31, 2), null);
console.log('✅ parser: 31-feb (no existe) = null');
assert.equal(parsearUfSii(HTML, 20, 10), null);
console.log('✅ parser: día que no está en la tabla = null');
assert.equal(parsearUfSii('<html>sin tabla</html>', 19, 10), null);
console.log('✅ parser: HTML sin tabla = null');

if (process.env.LIVE === '1') {
  const fecha = new Date(process.env.FECHA || '2026-10-19T15:00:00Z');
  obtenerValorUfHoy(fecha)
    .then((v) => console.log(`✅ SII real (${fecha.toISOString().slice(0, 10)}): UF = ${v}`))
    .catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
}
