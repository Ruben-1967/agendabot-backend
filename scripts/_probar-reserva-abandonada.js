#!/usr/bin/env node
// Prueba de humo (sin DB) de reservaAbandonada() -- confirma el umbral de
// 3h y los casos borde (sin historial, sin timestamp).

const { reservaAbandonada } = require('../src/services/flujoReserva');

let fallos = 0;
function assert(desc, cond) {
  console.log(`${cond ? '✅' : '⚠️ '} ${desc}`);
  if (!cond) fallos++;
}

const ahora = new Date('2026-09-23T12:00:00.000Z');

function historialConUltimoMensaje(horasAtras) {
  const ts = new Date(ahora.getTime() - horasAtras * 60 * 60 * 1000).toISOString();
  return [{ rol: 'usuario', contenido: 'x', timestamp: ts }];
}

assert('sin historial -> no abandonada (nada que abandonar)', !reservaAbandonada([], ahora));
assert('historial vacío/null -> no abandonada', !reservaAbandonada(null, ahora));
assert('último mensaje hace 5 minutos -> NO abandonada', !reservaAbandonada(historialConUltimoMensaje(5 / 60), ahora));
assert('último mensaje hace 2.9 horas -> NO abandonada (justo bajo el umbral)', !reservaAbandonada(historialConUltimoMensaje(2.9), ahora));
assert('último mensaje hace 3.1 horas -> SÍ abandonada (justo sobre el umbral)', reservaAbandonada(historialConUltimoMensaje(3.1), ahora));
assert('último mensaje hace 4 DÍAS (caso real de Diego) -> SÍ abandonada', reservaAbandonada(historialConUltimoMensaje(4 * 24), ahora));
assert('mensaje sin timestamp -> no abandonada (no se puede saber, no se fuerza)', !reservaAbandonada([{ rol: 'usuario', contenido: 'x' }], ahora));

console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s).`}`);
process.exitCode = fallos === 0 ? 0 : 1;
