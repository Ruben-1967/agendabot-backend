#!/usr/bin/env node
// Prueba unitaria (sin base de datos ni WhatsApp) de src/lib/clientePorTelefono.js.
// USO: node scripts/_probar-cliente-por-telefono-27oct.js
const { elegirClientePorTelefono } = require('../src/lib/clientePorTelefono');

const ana = { id: 'a', nombre: 'Ana Pérez', rut: '11111111-1' };
const sinRut = { id: 's', nombre: 'Sin nombre', rut: null };
const casos = [
  ['mismo RUT -> misma persona', [ana], '11111111-1', 'Ana Pérez', 'a'],
  ['otro RUT y otro nombre -> persona nueva', [ana], '22222222-2', 'Luis Pérez', null],
  ['otro RUT, mismo nombre (con tilde/mayúsculas) -> misma persona', [ana], '11111111-9', 'ANA PEREZ', 'a'],
  ['cliente del teléfono sin RUT -> se reusa', [sinRut], '22222222-2', 'Luis Pérez', 's'],
  ['sin RUT al agendar -> se reusa el primero', [ana], null, 'Luis Pérez', 'a'],
  ['sin candidatos -> nuevo', [], '22222222-2', 'Luis Pérez', null],
  ['dos candidatos, calza el segundo por RUT', [ana, { id: 'l', nombre: 'Luis Pérez', rut: '22222222-2' }], '22222222-2', 'Luis Pérez', 'l'],
];
let fallas = 0;
for (const [desc, cands, rut, nombre, esperado] of casos) {
  const r = elegirClientePorTelefono(cands, rut, nombre);
  const ok = (r ? r.id : null) === esperado;
  if (!ok) { fallas++; console.log(`⚠️  ${desc}: esperaba ${esperado}, obtuvo ${r ? r.id : null}`); }
}
console.log(fallas === 0 ? `✅ ${casos.length} casos OK` : `❌ ${fallas} de ${casos.length} fallaron`);
process.exitCode = fallas === 0 ? 0 : 1;
