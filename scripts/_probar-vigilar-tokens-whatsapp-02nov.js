#!/usr/bin/env node
// Prueba (sin red, sin base de datos, sin correo, sin WhatsApp) de la vigilancia de tokens de WhatsApp.
// USO: node scripts/_probar-vigilar-tokens-whatsapp-02nov.js
process.env.RESEND_API_KEY_MULTIDIGITAL = 'no-se-usa';
const assert = require('assert');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const empresas = [
  { id: 'a', nombre: 'Negocio Caido', whatsappToken: 'T_VENCIDO', whatsappNumeroId: '111' },
  { id: 'b', nombre: 'Negocio Sano', whatsappToken: 'T_NUNCA', whatsappNumeroId: '222' },
  { id: 'c', nombre: 'Negocio Por Vencer', whatsappToken: 'T_PRONTO', whatsappNumeroId: '333' },
  { id: 'd', nombre: 'Negocio Embedded', whatsappToken: 'T_EMBEDDED', whatsappNumeroId: '444' },
];
require.cache[require.resolve(path.join(raiz, 'src/lib/prisma'))] = {
  id: 'p', filename: 'p', loaded: true, exports: { empresa: { findMany: async () => empresas } },
};

const AHORA = new Date('2026-11-02T12:00:00Z');
const enDias = (n) => Math.floor((AHORA.getTime() + n * 86400000) / 1000);
let llamadas = [];
global.fetch = async (url, opts) => {
  const token = String(opts.headers.Authorization).replace('Bearer ', '');
  llamadas.push(`${url.includes('debug_token') ? 'debug' : 'numero'}:${token}`);
  const resp = (ok, json) => ({ ok, json: async () => json });
  if (token === 'T_VENCIDO') return resp(false, { error: { code: 190, message: 'The token has expired on Friday, 30-Oct-26' } });
  if (url.includes('debug_token')) {
    if (token === 'T_NUNCA') return resp(true, { data: { is_valid: true, expires_at: 0 } });
    if (token === 'T_PRONTO') return resp(true, { data: { is_valid: true, expires_at: enDias(3) } });
    return resp(false, { error: { code: 100, message: 'You must provide an app access token' } }); // Embedded: no se puede inspeccionar
  }
  return resp(true, { id: 'x' });
};

const { vigilarTokensWhatsApp, evaluarToken, debeAvisar } = require('../src/lib/vigilarTokensWhatsApp');

(async () => {
  let n = 0;
  const caso = async (fn) => { await fn(); n++; };

  await caso(() => {
    assert.strictEqual(evaluarToken({ ok: false, json: { error: { code: 190, message: 'x' } } }, null, AHORA).estado, 'INVALIDO');
    assert.strictEqual(evaluarToken({ ok: false, json: { error: { code: 4, message: 'rate' } } }, null, AHORA).estado, 'DESCONOCIDO');
    assert.strictEqual(evaluarToken({ ok: true, json: {} }, { ok: true, json: { data: { is_valid: true, expires_at: 0 } } }, AHORA).estado, 'OK');
    assert.strictEqual(evaluarToken({ ok: true, json: {} }, { ok: true, json: { data: { is_valid: true, expires_at: enDias(3) } } }, AHORA).estado, 'POR_VENCER');
    assert.strictEqual(evaluarToken({ ok: true, json: {} }, { ok: true, json: { data: { is_valid: true, expires_at: enDias(20) } } }, AHORA).estado, 'OK');
    assert.strictEqual(evaluarToken({ ok: true, json: {} }, { ok: false, json: { error: { code: 100 } } }, AHORA).estado, 'OK');
    assert.strictEqual(evaluarToken({ ok: true, json: {} }, { ok: true, json: { data: { is_valid: false } } }, AHORA).estado, 'INVALIDO');
  });

  await caso(() => {
    const h = (horas) => new Date(AHORA.getTime() - horas * 3600000);
    assert.strictEqual(debeAvisar(undefined, { estado: 'INVALIDO' }, AHORA), true);
    assert.strictEqual(debeAvisar({ estado: 'INVALIDO', avisadoEn: h(1) }, { estado: 'INVALIDO' }, AHORA), false);
    assert.strictEqual(debeAvisar({ estado: 'INVALIDO', avisadoEn: h(13) }, { estado: 'INVALIDO' }, AHORA), true);
    assert.strictEqual(debeAvisar({ estado: 'POR_VENCER', avisadoEn: h(13) }, { estado: 'POR_VENCER' }, AHORA), false);
    assert.strictEqual(debeAvisar({ estado: 'POR_VENCER', avisadoEn: h(1) }, { estado: 'INVALIDO' }, AHORA), true);
    assert.strictEqual(debeAvisar(undefined, { estado: 'OK' }, AHORA), false);
    assert.strictEqual(debeAvisar(undefined, { estado: 'DESCONOCIDO' }, AHORA), false);
  });

  await caso(async () => {
    const avisos = [];
    const enviar = async (a) => { avisos.push(a.asunto); };
    const r1 = await vigilarTokensWhatsApp({ ahora: AHORA, enviar });
    assert.deepStrictEqual({ ...r1 }, { revisadas: 4, ok: 2, invalidos: 1, porVencer: 1, desconocidos: 0, avisos: 2 });
    assert.ok(avisos[0].startsWith('URGENTE') && avisos[0].includes('Negocio Caido'));
    assert.ok(avisos[1].includes('Negocio Por Vencer'));
    const r2 = await vigilarTokensWhatsApp({ ahora: new Date(AHORA.getTime() + 30 * 60000), enviar });
    assert.strictEqual(r2.avisos, 0); // 30 min despues: sin avisos repetidos
    const r3 = await vigilarTokensWhatsApp({ ahora: new Date(AHORA.getTime() + 13 * 3600000), enviar });
    assert.strictEqual(r3.avisos, 1); // 13 h despues el caido se vuelve a avisar; el por-vencer (24 h) no
  });

  await caso(async () => {
    const r = await vigilarTokensWhatsApp({ ahora: new Date(AHORA.getTime() + 40 * 3600000), enviar: async () => { throw new Error('correo caido'); } });
    assert.strictEqual(r.avisos, 0); // si el correo falla no se cae el job ni se da por avisado
  });

  console.log(`✅ ${n} grupos de casos OK`);
})().catch((e) => { console.error('❌', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exitCode = 1; });
