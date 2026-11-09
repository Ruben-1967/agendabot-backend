#!/usr/bin/env node
// Prueba sin base de datos del anuncio de origen: guardarOrigenAnuncio con un referral real de
// Meta, sin referral, con datos incompletos o con la BD caída (nunca lanza), y que
// registrarLeadDesdeBot copie el anuncio a la ficha nueva o lo complete en una existente.
// USO: node scripts/_probar-origen-anuncio-09nov.js
const assert = require('assert');
const path = require('path');

const creados = [];
const fichas = [];
let bdCaida = false;
const prismaFalso = {
  origenAnuncio: {
    create: async ({ data }) => { if (bdCaida) throw new Error('BD caída'); creados.push({ ...data, creadoEn: new Date('2026-11-09T12:00:00Z') }); },
    findFirst: async ({ where }) => creados.filter((o) => o.phoneNumberId === where.phoneNumberId && o.telefono === where.telefono
      && (!where.creadoEn || o.creadoEn >= where.creadoEn.gte)).slice(-1)[0] || null,
  },
  clienteWeb: {
    findFirst: async ({ where }) => fichas.find((f) => f.telefono === where.telefono && f.etapa !== 'BAJA') || null,
    create: async ({ data }) => { const f = { id: `f${fichas.length + 1}`, ...data }; fichas.push(f); return f; },
    update: async ({ where, data }) => Object.assign(fichas.find((f) => f.id === where.id), data),
  },
};
require.cache[path.resolve(__dirname, '../src/lib/prisma.js')] = { exports: prismaFalso };
const claude = require('../src/services/claude');
claude.extraerDatosLeadWeb = async () => ({ negocio: 'Cabañas de prueba', contactoNombre: 'Prueba', preferencia: 'EJEMPLO' });

const { guardarOrigenAnuncio, buscarOrigenAnuncio } = require('../src/lib/origenAnuncio');
const { registrarLeadDesdeBot, EMPRESA_ID_CLIENTES_WEB } = require('../src/lib/leadClienteWeb');

// Teléfonos fijos de prueba (nunca generados).
const NUMERO = '100000000000001';
const TEL = '56900000001';
const TEL_FICHA = '56900000002';
const referral = {
  source_url: 'https://fb.me/abc', source_id: '120255000000000001', source_type: 'ad',
  headline: 'Sitio web + 2 correos $9.900 + IVA', body: 'x'.repeat(2000), ctwa_clid: 'clid-1',
};
const empresa = { id: EMPRESA_ID_CLIENTES_WEB, guionAtencion: 'guion', whatsappNumeroId: NUMERO };

(async () => {
  await guardarOrigenAnuncio({ phoneNumberId: NUMERO, telefono: TEL, referral });
  assert.strictEqual(creados.length, 1);
  assert.strictEqual(creados[0].sourceId, '120255000000000001');
  assert.strictEqual(creados[0].titulo, 'Sitio web + 2 correos $9.900 + IVA');
  assert.strictEqual(creados[0].texto.length, 1000, 'el texto se recorta');

  await guardarOrigenAnuncio({ phoneNumberId: NUMERO, telefono: TEL, referral: undefined });
  await guardarOrigenAnuncio({ phoneNumberId: null, telefono: TEL, referral });
  assert.strictEqual(creados.length, 1, 'sin referral o sin número no guarda nada');

  bdCaida = true;
  await guardarOrigenAnuncio({ phoneNumberId: NUMERO, telefono: TEL, referral });
  bdCaida = false;
  assert.strictEqual(creados.length, 1, 'con la BD caída no lanza');

  assert.strictEqual(await buscarOrigenAnuncio({ phoneNumberId: 'otro', telefono: TEL }), null, 'otro número del negocio no se mezcla');
  assert.strictEqual(await buscarOrigenAnuncio({ phoneNumberId: NUMERO, telefono: TEL, ahora: new Date('2027-01-15T12:00:00Z') }), null, 'un anuncio de hace más de 30 días no cuenta');

  await registrarLeadDesdeBot({ empresa, telefono: TEL, canal: 'whatsapp', mensajes: [] });
  assert.strictEqual(fichas.length, 1);
  assert.strictEqual(fichas[0].anuncioOrigen.sourceId, '120255000000000001');
  assert.strictEqual(fichas[0].anuncioOrigen.titulo, 'Sitio web + 2 correos $9.900 + IVA');

  // Ficha creada a mano antes, sin anuncio: el bot se lo completa.
  fichas.push({ id: 'manual', telefono: TEL_FICHA, etapa: 'EN_ESPERA', origen: 'MANUAL', negocio: 'Manual', anuncioOrigen: null });
  await guardarOrigenAnuncio({ phoneNumberId: NUMERO, telefono: TEL_FICHA, referral: { ...referral, source_id: '2' } });
  await registrarLeadDesdeBot({ empresa, telefono: TEL_FICHA, canal: 'whatsapp', mensajes: [] });
  assert.strictEqual(fichas.find((f) => f.id === 'manual').anuncioOrigen.sourceId, '2');

  // Sin anuncio de origen, la ficha queda con anuncioOrigen null.
  await registrarLeadDesdeBot({ empresa, telefono: '56900000003', canal: 'whatsapp', mensajes: [] });
  assert.strictEqual(fichas[fichas.length - 1].anuncioOrigen, null);

  console.log('✅ 9 casos OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });
