#!/usr/bin/env node
/**
 * Pruebas del asistente de DEMOS (una empresa compartida, una clave por demo), sin base de
 * datos ni Anthropic: prisma y el motor van simulados. No envía nada ni escribe en ninguna base.
 *
 * Uso: node scripts/_probar-asistente-demo-18nov.js
 */
process.env.CHAT_WEB_PERMITIR_LOCALHOST = '';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { crearRouterChatWeb } = require('../src/routes/chatWeb');
const { empresaParaAsistente, telefonoWeb, demoVencida, crearBuscadorAsistentes } = require('../src/lib/asistenteWeb');
const { leerDatos } = require('./alta-asistente-demo');
const { armarCorreoInteresado } = require('../src/services/emailInteresadoWeb');

let ok = 0;
function caso(nombre, fn) { return Promise.resolve().then(fn).then(() => { ok++; console.log('OK ', nombre); }); }

const EMP_DEMOS = 'empresa-demos';
const ORIGEN = 'https://muestras.multidigital.cl';
const SES = 'abcdefghijklmnopqrstuvwx';
const BASE = {
  id: EMP_DEMOS, nombre: 'Demos Multidigital', modoInformativo: true, informacionAdicional: 'INFO GENERICA',
  guionAtencion: 'GUION GENERICO', sitioWeb: 'https://multidigital.cl', direccion: 'Dirección de la empresa contenedora',
};
function demo(clave, extra = {}) {
  return {
    empresaId: EMP_DEMOS, titulo: `Asistente ${clave}`, nombreNegocio: clave === 'demo-a' ? 'Terrabliss' : 'Funeraria López',
    saludo: 'Hola', color: '#1D4ED8', whatsapp: '56935682148', origenes: ['muestras.multidigital.cl'],
    correoAvisos: ['contacto@multidigital.cl'], conversacionesMes: 30, demo: true,
    informacion: `INFO DE ${clave}`, guion: `GUION DE ${clave}`, venceEn: new Date(Date.now() + 86400000), ...extra,
  };
}
const ASIS = { 'demo-a': demo('demo-a'), 'demo-b': demo('demo-b'), 'demo-vieja': demo('demo-vieja', { venceEn: new Date(Date.now() - 1000) }) };

function crearPrisma() {
  const convs = []; const counts = [];
  return {
    convs, counts,
    empresa: { findUnique: async () => ({ ...BASE }) },
    conversacion: {
      findFirst: async ({ where }) => convs.find((c) => c.telefono === where.telefono && c.canal === where.canal) || null,
      count: async (q) => { counts.push(q.where); return 0; },
      updateMany: async () => ({ count: 0 }),
    },
  };
}
function crearMotor(prisma) {
  const llamadas = [];
  const fn = async (p) => {
    llamadas.push(p);
    if (!prisma.convs.find((c) => c.telefono === p.telefonoCliente)) prisma.convs.push({ telefono: p.telefonoCliente, canal: p.canal, mensajes: [] });
    return { respuestaTexto: 'ok', escalado: false };
  };
  fn.llamadas = llamadas;
  return fn;
}
async function servidor(deps) {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/chat-web', crearRouterChatWeb({ avisarInteresado: () => {}, buscarAsistente: async (c) => ASIS[c] || null, ...deps }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
async function post(s, body, origin = ORIGEN) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}/chat-web/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
function jsonTemporal(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-')), 'd.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}
const INFO_OK = 'Terrabliss hace limpieza y mantención de piscinas y jardines en Santiago. Servicios de ejemplo: limpieza de piscinas, corte de pasto.';

(async () => {
  await caso('empresaParaAsistente: en demo reemplaza nombre, información y guion, y quita sitio/dirección', () => {
    const e = empresaParaAsistente(BASE, ASIS['demo-a']);
    assert.strictEqual(e.nombre, 'Terrabliss');
    assert.strictEqual(e.informacionAdicional, 'INFO DE demo-a');
    assert.strictEqual(e.guionAtencion, 'GUION DE demo-a');
    assert.strictEqual(e.sitioWeb, null); assert.strictEqual(e.direccion, null);
    assert.strictEqual(e.id, EMP_DEMOS);
    assert.strictEqual(BASE.nombre, 'Demos Multidigital', 'no modifica el objeto original');
  });
  await caso('empresaParaAsistente: un asistente normal no toca la empresa', () => {
    assert.strictEqual(empresaParaAsistente(BASE, { demo: false, informacion: 'x' }), BASE);
  });
  await caso('telefonoWeb: demo lleva la clave; normal queda igual que antes', () => {
    assert.strictEqual(telefonoWeb(ASIS['demo-a'], 'DEMO-A', SES), `web:demo-a:${SES}`);
    assert.strictEqual(telefonoWeb({ demo: false }, 'multidigital', SES), `web:${SES}`);
  });
  await caso('demoVencida: solo demos con fecha pasada', () => {
    assert.ok(demoVencida(ASIS['demo-vieja']));
    assert.ok(!demoVencida(ASIS['demo-a']));
    assert.ok(!demoVencida({ demo: false, venceEn: new Date(0) }));
  });
  await caso('buscador: la fila de base trae los campos de demo', async () => {
    const buscar = crearBuscadorAsistentes({ asistenteWeb: { findUnique: async () => ({ ...ASIS['demo-a'], activo: true, demo: true }) } });
    const a = await buscar('demo-a');
    assert.strictEqual(a.demo, true); assert.strictEqual(a.informacion, 'INFO DE demo-a'); assert.ok(a.venceEn);
  });
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('mensaje a demo: el motor recibe la empresa con la info de la demo y el contacto con clave', async () => {
      const r = await post(s, { clave: 'demo-a', sesion: SES, texto: 'hola' });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.respuesta, 'ok');
      const p = motor.llamadas[0];
      assert.strictEqual(p.telefonoCliente, `web:demo-a:${SES}`);
      assert.strictEqual(p.empresa.nombre, 'Terrabliss');
      assert.strictEqual(p.empresa.informacionAdicional, 'INFO DE demo-a');
      assert.strictEqual(p.canal, 'web');
    });
    await caso('tope del mes: en demos cuenta solo las conversaciones de esa clave', async () => {
      assert.deepStrictEqual(prisma.counts[0].telefono, { startsWith: 'web:demo-a:' });
      assert.strictEqual(prisma.counts[0].empresaId, EMP_DEMOS);
    });
    await caso('misma persona (misma sesión) en dos demos: conversaciones separadas', async () => {
      await post(s, { clave: 'demo-b', sesion: SES, texto: 'hola' });
      const tels = motor.llamadas.map((l) => l.telefonoCliente);
      assert.deepStrictEqual(tels, [`web:demo-a:${SES}`, `web:demo-b:${SES}`]);
      assert.strictEqual(motor.llamadas[1].empresa.nombre, 'Funeraria López');
      assert.strictEqual(prisma.counts.length, 2, 'la segunda demo también es conversación nueva');
    });
    await caso('demo vencida: "no disponible" sin llamar al modelo', async () => {
      const antes = motor.llamadas.length;
      const r = await post(s, { clave: 'demo-vieja', sesion: SES, texto: 'hola' });
      assert.strictEqual(r.json.limite, true);
      assert.strictEqual(motor.llamadas.length, antes);
    });
    await caso('demo desde otro sitio: 403', async () => {
      const r = await post(s, { clave: 'demo-a', sesion: SES, texto: 'hola' }, 'https://otro-sitio.cl');
      assert.strictEqual(r.status, 403);
    });
    await caso('privacidad de demo: dice que es un ejemplo y que Multidigital es responsable', async () => {
      const html = await (await fetch(`http://127.0.0.1:${s.address().port}/chat-web/privacidad?clave=demo-a`)).text();
      assert.ok(html.includes('Este sitio es un ejemplo'));
      assert.ok(html.includes('<b>Multidigital</b> (multidigital.cl) es responsable'));
      assert.ok(html.includes('se le envían a Multidigital'));
      assert.ok(!html.includes('por encargo de Terrabliss'));
    });
    await caso('config de demo vencida: 403 (la burbuja no aparece)', async () => {
      const r = await fetch(`http://127.0.0.1:${s.address().port}/chat-web/config?clave=demo-vieja`, { headers: { Origin: ORIGEN } });
      assert.strictEqual(r.status, 403);
      const r2 = await fetch(`http://127.0.0.1:${s.address().port}/chat-web/config?clave=demo-a`, { headers: { Origin: ORIGEN } });
      assert.strictEqual(r2.status, 200);
    });
    s.close();
  }
  await caso('correo de interesado de demo: asunto [Demo], aviso de que no es cliente y saludo desde Multidigital', () => {
    const datos = { nombre: 'Ana Pérez', telefono: '56911111111', telefonoEscrito: null, correo: null, necesidad: 'limpieza' };
    const c = armarCorreoInteresado({ asistente: ASIS['demo-a'], datos, mensajes: [] });
    assert.ok(c.asunto.includes('[Demo Terrabliss]'));
    assert.ok(c.html.includes('aún no es cliente'));
    assert.ok(c.html.includes(encodeURIComponent('te escribo de Multidigital')));
    const normal = armarCorreoInteresado({ asistente: { ...ASIS['demo-a'], demo: false }, datos, mensajes: [] });
    assert.ok(normal.asunto.startsWith('🔔 Nuevo interesado desde tu sitio web'));
  });
  await caso('leerDatos: valores por defecto (45 días, 30 conversaciones, muestras, aviso a Multidigital)', () => {
    const ahora = new Date('2026-11-18T12:00:00Z');
    const d = leerDatos(jsonTemporal({ clave: 'demo-terrabliss', nombreNegocio: 'Terrabliss', whatsapp: '+56 9 3568 2148', informacion: INFO_OK }), ahora);
    assert.strictEqual(d.whatsapp, '56935682148');
    assert.deepStrictEqual(d.origenes, ['muestras.multidigital.cl']);
    assert.deepStrictEqual(d.correoAvisos, ['contacto@multidigital.cl']);
    assert.strictEqual(d.conversacionesMes, 30);
    assert.strictEqual(d.demo, true);
    assert.strictEqual(d.venceEn.toISOString().slice(0, 10), '2027-01-02');
    assert.ok(d.informacion.startsWith('Esta es la ÚNICA información que puedes citar sobre Terrabliss.'));
    assert.ok(d.guion.includes('No informes precios'));
  });
  await caso('leerDatos: rechaza clave sin "demo-", precios en la información y WhatsApp faltante', () => {
    assert.throws(() => leerDatos(jsonTemporal({ clave: 'terrabliss', nombreNegocio: 'T', whatsapp: '56935682148', informacion: INFO_OK })), /demo-/);
    assert.throws(() => leerDatos(jsonTemporal({ clave: 'demo-t', nombreNegocio: 'T', whatsapp: '56935682148', informacion: `${INFO_OK} Desde $25.000.` })), /precios/);
    assert.throws(() => leerDatos(jsonTemporal({ clave: 'demo-t', nombreNegocio: 'T', informacion: INFO_OK })), /whatsapp/);
  });
  console.log(`\n${ok} casos OK`);
})().catch((e) => { console.error('FALLÓ:', e.message); process.exit(1); });
