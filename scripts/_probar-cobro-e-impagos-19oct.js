#!/usr/bin/env node
// Pruebas puras (sin base de datos, sin Flow, sin correos, sin WhatsApp) de:
//   - src/lib/cicloCobro.js (días hasta el día de cobro del mes siguiente, hora de Chile)
//   - src/lib/impagos.js (etapas aviso 1 -> aviso 2 -> corte)
//   - src/lib/estadoServicio.js (qué POST se permiten con el servicio pausado)
// Fechas FIJAS, nada aleatorio.
//
// USO: node scripts/_probar-cobro-e-impagos-19oct.js

const assert = require('node:assert/strict');
const { diasHastaProximoCobro } = require('../src/lib/cicloCobro');
const { ACCION, accionImpago, calcularCorteImpago, corteTrasAviso2 } = require('../src/lib/impagos');
const { esPostPermitido } = require('../src/lib/estadoServicio');

let n = 0;
const ok = (txt) => { n++; console.log(`✅ ${txt}`); };

// --- Día de cobro (Chile: verano UTC-3 en oct-mar) ---
const casosCobro = [
  ['día 7: 19-oct -> 7-nov', '2026-10-19T15:00:00Z', 7, 19],
  ['día 7: 3-oct (antes del 7) -> 7-nov, no el 7-oct', '2026-10-03T15:00:00Z', 7, 35],
  ['día 7: 31-oct -> 7-nov', '2026-10-31T15:00:00Z', 7, 7],
  ['día 7: 7-nov mismo día -> 7-dic', '2026-11-07T15:00:00Z', 7, 30],
  ['día 7: 15-dic -> 7-ene (cruce de año)', '2026-12-15T15:00:00Z', 7, 23],
  ['día 7: 31-ene -> 7-feb', '2027-01-31T15:00:00Z', 7, 7],
  ['día 7: Chile aún 18-oct (UTC ya 19-oct 02:00) -> 7-nov', '2026-10-19T02:00:00Z', 7, 20],
  ['día 1: 19-oct -> 1-nov', '2026-10-19T15:00:00Z', 1, 13],
  ['día 28: 31-ene -> 28-feb', '2027-01-31T15:00:00Z', 28, 28],
];
for (const [desc, instante, dia, esperado] of casosCobro) {
  const real = diasHastaProximoCobro(new Date(instante), dia);
  assert.equal(real, esperado, `${desc}: esperaba ${esperado}, dio ${real}`);
  ok(`${desc}: ${real} días`);
}
for (const malo of [0, 29, 31, -1, 7.5, '7', null]) {
  assert.throws(() => diasHastaProximoCobro(new Date('2026-10-19T15:00:00Z'), malo), /inválido/);
}
ok('día de cobro inválido (0, 29, 31, negativo, decimal, texto, null) se rechaza');

// --- Impagos ---
const t0 = new Date('2026-11-07T15:00:00Z'); // primer cobro fallido
const dias = (d) => new Date(t0.getTime() + d * 86400000);

assert.equal(accionImpago({ impagoDesde: null, corteImpagoEn: null, avisosImpagoEnviados: 0 }, t0), null);
ok('sin impago: no hace nada');
assert.equal(accionImpago({ impagoDesde: t0, corteImpagoEn: null, avisosImpagoEnviados: 0 }, t0), ACCION.AVISO_1);
ok('impago nuevo: aviso 1');
const corte = calcularCorteImpago(t0);
assert.equal(corte.getTime(), dias(10).getTime());
ok('el corte se fija 10 días después del aviso 1');

const tr = { impagoDesde: t0, corteImpagoEn: corte };
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 1 }, dias(2)), null);
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 1 }, dias(4.5)), null);
ok('antes del día 5: no hay aviso 2');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 1 }, dias(5)), ACCION.AVISO_2);
ok('día 5: aviso 2');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 2 }, dias(9.5)), null);
ok('entre aviso 2 y el corte: nada');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 2 }, dias(10)), ACCION.CORTE);
ok('día 10 con ambos avisos enviados: corte');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 1 }, dias(12)), ACCION.AVISO_2);
ok('día 12 pero el aviso 2 nunca salió: se manda el aviso 2, NO se corta');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 0 }, dias(30)), ACCION.AVISO_1);
ok('día 30 sin ningún aviso enviado: aviso 1 primero, NO se corta');
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 3 }, dias(40)), null);
ok('ya cortado: no repite');
assert.equal(accionImpago({ impagoDesde: t0, corteImpagoEn: null, avisosImpagoEnviados: 1 }, dias(40)), null);
ok('aviso 1 enviado sin fecha de corte (dato inconsistente): no se actúa');

// Tolerancia: el job corre a la misma hora cada día; un desfase de milisegundos no mueve el plazo un día.
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 1 }, new Date(dias(5).getTime() - 1000)), ACCION.AVISO_2);
assert.equal(accionImpago({ ...tr, avisosImpagoEnviados: 2 }, new Date(dias(10).getTime() - 1000)), ACCION.CORTE);
ok('desfase de 1 segundo antes del plazo: igual se actúa ese día (tolerancia)');
// Margen mínimo aviso 2 -> corte aunque el job haya estado caído.
assert.equal(corteTrasAviso2(corte, dias(5)).getTime(), corte.getTime());
assert.equal(corteTrasAviso2(corte, dias(12)).getTime(), dias(15).getTime());
ok('aviso 2 tardío: el corte se corre para dar al menos 3 días de margen');

// --- POST permitidos con el servicio pausado ---
const permitidos = ['/auth/login', '/suscripcion/elegir-plan', '/billetera/comprar', '/empresa/whatsapp/conectar', '/disponibilidad/abc/validar', '/clientes/1/fusionar-en/2', '/agenda/citas/9/reagendar', '/conversaciones/e/c/mensaje'];
const bloqueados = ['/clientes', '/clientes/', '/clientes/1/ventas', '/clientes/1/ventas/lote', '/clientes/1/atenciones', '/agenda/citas', '/agenda/profesionales', '/agenda/bloqueos', '/servicios', '/productos', '/lista-espera', '/lista-espera/5/agendar', '/empresa/catalogo/items', '/empresa/catalogo/categorias', '/empresa/plantillas-rapidas', '/empresa/recordatorio-control-anual/importar'];
for (const r of permitidos) assert.equal(esPostPermitido(r), true, `debería permitir POST ${r}`);
for (const r of bloqueados) assert.equal(esPostPermitido(r), false, `debería bloquear POST ${r}`);
ok(`${permitidos.length} rutas POST permitidas y ${bloqueados.length} bloqueadas, como se definió`);

console.log(`\n${n} grupos de pruebas OK.`);
