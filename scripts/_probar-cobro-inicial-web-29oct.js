#!/usr/bin/env node
// Prueba unitaria (sin base de datos, sin Flow) del cobro inicial combinado de la suscripción
// web: promo del hosting por fecha, montos con IVA, y que la página muestre el desglose.
// USO: node scripts/_probar-cobro-inicial-web-29oct.js
process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:0';
const assert = require('assert');
const { descuentoHostingPrimerAnio, calcularCobroInicial } = require('../src/lib/preciosWeb');
const { renderSuscribir, renderResultado } = require('../src/services/suscripcionWebHtml');
const { _interno } = require('../src/routes/suscripcionWeb');

// Mediodía de Chile (UTC-3 en octubre/noviembre) en fechas fijas.
const dia = (aaaammdd, hora = '12:00:00') => new Date(`${aaaammdd}T${hora}-03:00`);
let n = 0;
const ok = (desc, fn) => { fn(); n++; };

ok('50% hasta el 31-oct, aun a las 23:59 de Chile', () => {
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2026-10-29')), 0.5);
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2026-10-31', '23:59:00')), 0.5);
});
ok('20% desde el 1-nov hasta el 30-nov', () => {
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2026-11-01', '00:01:00')), 0.2);
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2026-11-30', '23:59:00')), 0.2);
});
ok('sin promo desde el 1-dic', () => {
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2026-12-01', '00:01:00')), 0);
  assert.strictEqual(descuentoHostingPrimerAnio(dia('2027-03-10')), 0);
});

const UF = 41199.85; // UF del 22-oct (la usada al crear el plan de hosting en Flow)
ok('hosting completo = el monto del plan de Flow ($49.028)', () => {
  assert.strictEqual(calcularCobroInicial({ montoPlanConIva: 11781, valorUf: UF, fecha: dia('2026-12-15') }).montoHosting, 49028);
});
ok('mensual + hosting con 50%', () => {
  const c = calcularCobroInicial({ montoPlanConIva: 11781, valorUf: UF, fecha: dia('2026-10-29') });
  assert.strictEqual(c.montoHosting, Math.round(UF * 0.5 * 1.19));
  assert.strictEqual(c.total, 11781 + c.montoHosting);
  assert.strictEqual(c.montoHostingCompleto, 49028);
});
ok('anual + hosting con 20%', () => {
  const c = calcularCobroInicial({ montoPlanConIva: 113050, valorUf: UF, fecha: dia('2026-11-10') });
  assert.strictEqual(c.montoHosting, Math.round(UF * 0.8 * 1.19));
  assert.strictEqual(c.total, 113050 + c.montoHosting);
});

const sw = { ref: 'abc', plan: 'MENSUAL', montoConIva: 11781, dominio: 'ejemplo.cl', emailCliente: 'a@b.cl', fechaPrimerCobro: null, hostingAlRegistrar: true };
ok('la pagina muestra "Hoy pagas" con el desglose', () => {
  const c = calcularCobroInicial({ montoPlanConIva: 11781, valorUf: UF, fecha: dia('2026-10-29') });
  const html = renderSuscribir(sw, { cobroInicial: c });
  assert.ok(html.includes('Hoy pagas'));
  assert.ok(html.includes('50% de descuento'));
  assert.ok(html.includes(c.total.toLocaleString('es-CL')));
});
ok('sin cobro inicial (link viejo) la pagina queda como antes', () => {
  const html = renderSuscribir({ ...sw, hostingAlRegistrar: false });
  assert.ok(!html.includes('Hoy pagas'));
  assert.ok(html.includes('El primer cargo se hace al registrar tu tarjeta.'));
});
ok('la pagina manda el total mostrado en un campo oculto (el servidor lo compara al aceptar)', () => {
  const c = calcularCobroInicial({ montoPlanConIva: 11781, valorUf: UF, fecha: dia('2026-10-29') });
  assert.ok(renderSuscribir(sw, { cobroInicial: c }).includes(`name="totalMostrado" value="${c.total}"`));
  assert.ok(!renderSuscribir({ ...sw, hostingAlRegistrar: false }).includes('totalMostrado'));
});
ok('"procesando" de un link viejo no habla de primer pago', () => {
  assert.ok(!renderResultado('procesando', { ...sw, hostingAlRegistrar: false, fechaPrimerCobro: new Date() }).includes('primer pago'));
  assert.ok(renderResultado('procesando', sw).includes('primer pago'));
});
ok('pagina de exito con cobro inicial hecho', () => {
  const html = renderResultado('exito', { ...sw, estado: 'ACTIVA', fechaInicioContrato: dia('2026-10-29'), tarjetaUltimos4: '1234' });
  assert.ok(html.includes('Recibimos tu primer pago'));
});
ok('usaCobroInicial: solo links nuevos sin fecha de primer cobro', () => {
  assert.strictEqual(_interno.usaCobroInicial(sw), true);
  assert.strictEqual(_interno.usaCobroInicial({ ...sw, hostingAlRegistrar: false }), false);
  assert.strictEqual(_interno.usaCobroInicial({ ...sw, fechaPrimerCobro: new Date() }), false);
});

console.log(`✅ ${n} casos OK`);
