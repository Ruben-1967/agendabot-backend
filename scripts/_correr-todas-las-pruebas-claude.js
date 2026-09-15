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

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const EXCLUIR = ['_correr-todas-las-pruebas-claude.js'];

// Algunos scripts usan negocios de DEMO que solo existen en Staging (ej.
// "Estudio Bella Piel", 007a8c7b-...) -- si este runner corre en
// producción, esos van a fallar con un error de foreign key o "Cannot
// read properties of null", que NO es una falla real del bot, es que la
// prueba corrió en el entorno equivocado. Se detecta leyendo el ID en el
// propio archivo del script, no hardcodeando una lista aparte que se
// puede desactualizar.
const ID_EMPRESA_DEMO_SOLO_STAGING = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46';

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

  // execFileSync solo devuelve stdout cuando el proceso sale con código 0
  // -- si el script hijo atrapa su propio error (try/catch interno sin
  // relanzar, ej. _probar-nunca-vosea.js) el mensaje sale por stderr y el
  // proceso igual sale con 0, así que ese texto se perdía por completo
  // (bug real encontrado 2026-09-17: por eso ese script SIEMPRE aparecía
  // sin marcador, incluso después del primer fix del detector de "N/A").
  // spawnSync entrega stdout Y stderr por separado sin importar el código
  // de salida, así que se concatenan siempre.
  const resultado = spawnSync('node', [ruta], { encoding: 'utf8', timeout: 120000 });
  const crasheo = resultado.status !== 0;
  const salida = (resultado.stdout || '') + '\n' + (resultado.stderr || '');

  console.log(salida.trim());
  console.log('');

  const esErrorDeEntornoEquivocado = /foreign key constraint violated|cannot read propert.* of null/i.test(salida);
  const usaEmpresaDemoSoloStaging = fs.readFileSync(ruta, 'utf8').includes(ID_EMPRESA_DEMO_SOLO_STAGING);
  // Algunos scripts atrapan su propio error (ej. `.catch(e => console.error(...))`
  // sin volver a lanzar) -- el proceso termina con código 0 igual, así que
  // "crasheo" queda false aunque el mensaje de error esté en stdout. Por
  // eso este chequeo no depende de crasheo, solo del contenido de la salida.
  const esN_A = esErrorDeEntornoEquivocado && usaEmpresaDemoSoloStaging;

  let estado;
  if (esN_A || /⏭️/.test(salida)) {
    estado = 'N/A'; // prueba de demo de Staging corrida en el entorno equivocado, o el propio script se saltó a sí mismo (ej. fecha de prueba ya pasada) -- no es una falla real
  } else if (crasheo) {
    estado = 'CRASH';
  } else if (/✅/.test(salida) && !/⚠️/.test(salida)) {
    estado = 'PASS';
  } else if (/⚠️/.test(salida)) {
    estado = 'FALLO';
  } else if (/fallos?:\s*0\b/i.test(salida)) {
    estado = 'PASS'; // convención más vieja ("Fallos: 0 de N") sin el marcador ✅
  } else {
    estado = '¿?'; // el script no imprimió ningún marcador reconocible -- revisar a mano
  }

  resultados.push({ nombre, estado });
}

console.log('='.repeat(70));
console.log('RESUMEN');
console.log('='.repeat(70));
const ICONOS = { PASS: '✅', FALLO: '⚠️ ', CRASH: '❌', 'N/A': '⏭️ ', '¿?': '❓' };
for (const r of resultados) {
  console.log(`${ICONOS[r.estado]} ${r.estado.padEnd(6)} ${r.nombre}`);
}

const noAplica = resultados.filter((r) => r.estado === 'N/A');
const fallosReales = resultados.filter((r) => r.estado === 'FALLO' || r.estado === 'CRASH');
const sinClasificar = resultados.filter((r) => r.estado === '¿?');
const pases = resultados.filter((r) => r.estado === 'PASS');

console.log(`\n${pases.length}/${resultados.length} en PASS.`);
if (noAplica.length > 0) {
  console.log(`${noAplica.length} no aplican a este entorno (prueban con negocios de demo de Staging) -- correrlos ahí en vez de acá.`);
}
if (sinClasificar.length > 0) {
  console.log(`${sinClasificar.length} sin marcador reconocible -- revisar la salida de arriba a mano.`);
}
if (fallosReales.length > 0) {
  console.log(`${fallosReales.length} falla(s) real(es) -- revisar el detalle de arriba.`);
  process.exitCode = 1;
}
