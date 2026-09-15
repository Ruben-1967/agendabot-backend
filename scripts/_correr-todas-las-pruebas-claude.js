#!/usr/bin/env node
/**
 * Corre TODOS los scripts de reproducción _probar-*.js relacionados con
 * generarRespuestaChatbot (claude.js) en una sola pasada, y resume
 * pasa/falla al final -- para no tener que correrlos uno por uno a mano
 * cada vez que cambia algo importante (ej. el modelo, 2026-09-16: Haiku
 * 4.5 -> Sonnet 5).
 *
 * Cada script hijo ya tiene su propia limpieza (cliente/conversación/cita
 * de prueba) -- este wrapper solo los ejecuta en secuencia y lee su
 * salida, no toca la base directamente.
 *
 * USO (Shell de Render -- producción para que corran también los scripts
 * de Ahorróptica, que no existe en Staging):
 *   node scripts/_correr-todas-las-pruebas-claude.js
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const EXCLUIR = ['_correr-todas-las-pruebas-claude.js'];

const scripts = fs.readdirSync(DIR)
  .filter((f) => f.startsWith('_probar-') && f.endsWith('.js'))
  .filter((f) => !EXCLUIR.includes(f))
  .sort();

console.log(`Corriendo ${scripts.length} script(s) de prueba:\n`);

const resultados = [];

for (const nombre of scripts) {
  const ruta = path.join(DIR, nombre);
  console.log('='.repeat(70));
  console.log(nombre);
  console.log('='.repeat(70));

  let salida = '';
  let crasheo = false;
  try {
    salida = execFileSync('node', [ruta], { encoding: 'utf8', timeout: 120000 });
  } catch (err) {
    crasheo = true;
    salida = (err.stdout || '') + '\n' + (err.stderr || err.message || '');
  }

  console.log(salida.trim());
  console.log('');

  let estado;
  if (crasheo) {
    estado = 'CRASH';
  } else if (/✅/.test(salida) && !/⚠️/.test(salida)) {
    estado = 'PASS';
  } else if (/⚠️/.test(salida)) {
    estado = 'FALLO';
  } else {
    estado = '¿?'; // el script no imprimió ningún marcador reconocible
  }

  resultados.push({ nombre, estado });
}

console.log('='.repeat(70));
console.log('RESUMEN');
console.log('='.repeat(70));
for (const r of resultados) {
  const icono = r.estado === 'PASS' ? '✅' : r.estado === 'FALLO' ? '⚠️ ' : r.estado === 'CRASH' ? '❌' : '❓';
  console.log(`${icono} ${r.estado.padEnd(6)} ${r.nombre}`);
}

const fallos = resultados.filter((r) => r.estado !== 'PASS');
console.log(`\n${resultados.length - fallos.length}/${resultados.length} en PASS.`);
if (fallos.length > 0) {
  console.log('Revisar el detalle de arriba para los que no pasaron.');
  process.exitCode = 1;
}
