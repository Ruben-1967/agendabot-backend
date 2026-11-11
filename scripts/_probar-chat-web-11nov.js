#!/usr/bin/env node
/**
 * Pruebas del asistente de sitios web (ruta /chat-web), sin base de datos ni Anthropic:
 * prisma y el motor van simulados. No envía nada ni escribe en ninguna base.
 *
 * Uso: node scripts/_probar-chat-web-11nov.js
 */
process.env.CHAT_WEB_PERMITIR_LOCALHOST = '';
const assert = require('assert');
const express = require('express');
const { crearRouterChatWeb } = require('../src/routes/chatWeb');
const { origenPermitido, asistentePorClave, inicioMesChile, ASISTENTES_WEB } = require('../src/lib/asistenteWeb');
const { _interno: { telefonoDado } } = require('../src/lib/leadClienteWeb');

let ok = 0;
function caso(nombre, fn) { return Promise.resolve().then(fn).then(() => { ok++; console.log('OK ', nombre); }); }

const EMP = ASISTENTES_WEB.multidigital.empresaId;
const ORIGEN = 'https://multidigital.cl';

// Prisma simulado: conversaciones en memoria.
function crearPrisma({ conversacionesDelMes = 0, empresa = { id: EMP, modoInformativo: true } } = {}) {
  const convs = [];
  return {
    convs,
    empresa: { findUnique: async () => empresa },
    conversacion: {
      findFirst: async ({ where }) => convs.find((c) => c.telefono === where.telefono && c.canal === where.canal) || null,
      count: async () => conversacionesDelMes,
    },
  };
}
// Motor simulado: guarda el turno como lo haría chatbotEngine.
function crearMotor(prisma, { derivarAl = null, respuesta = 'Respuesta de prueba' } = {}) {
  const llamadas = [];
  const fn = async (p) => {
    llamadas.push(p);
    let c = prisma.convs.find((x) => x.telefono === p.telefonoCliente);
    if (!c) { c = { telefono: p.telefonoCliente, canal: p.canal, mensajes: [], escaladoAHumano: false }; prisma.convs.push(c); }
    // Como chatbotEngine: con el chat pausado no responde; al derivar marca escalado + pausa.
    if (c.pausadaPorHumanoEn) return { respuestaTexto: null };
    c.mensajes.push({ rol: 'usuario', contenido: p.textoEntrante }, { rol: 'asistente', contenido: respuesta });
    if (derivarAl && c.mensajes.length / 2 >= derivarAl) { c.escaladoAHumano = true; c.pausadaPorHumanoEn = new Date(Date.UTC(2026, 10, 11, 18, c.mensajes.length)); }
    return { respuestaTexto: respuesta };
  };
  fn.llamadas = llamadas;
  return fn;
}

async function servidor(deps) {
  const app = express();
  app.set('trust proxy', 1);
  // Sin parser global: como en server.js, /chat-web lee su propio body (4 KB).
  // El aviso real llama a Anthropic y Resend: en las pruebas siempre va simulado.
  app.use('/chat-web', crearRouterChatWeb({ avisarInteresado: () => {}, ...deps }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
async function post(s, body, origin = ORIGEN) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}/chat-web/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
  });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => ({})) };
}
const SES = 'abcdefghijklmnopqrstuvwx';

(async () => {
  await caso('telefonoDado normaliza celulares chilenos y descarta basura', () => {
    assert.strictEqual(telefonoDado('+56 9 1234 5678'), '56912345678');
    assert.strictEqual(telefonoDado('912345678'), '56912345678');
    assert.strictEqual(telefonoDado('9 1234 5678'), '56912345678');
    assert.strictEqual(telefonoDado('+52 1 833 111 3275'), '5218331113275');
    assert.strictEqual(telefonoDado('12345'), null);
    assert.strictEqual(telefonoDado(''), null);
    assert.strictEqual(telefonoDado(undefined), null);
  });
  await caso('origenPermitido: solo los sitios del asistente', () => {
    const a = asistentePorClave('multidigital');
    assert.ok(origenPermitido(a, 'https://multidigital.cl'));
    assert.ok(origenPermitido(a, 'https://www.multidigital.cl'));
    assert.ok(origenPermitido(a, 'https://muestras.multidigital.cl'));
    assert.ok(!origenPermitido(a, 'https://multidigital.cl.evil.com'));
    assert.ok(!origenPermitido(a, 'https://evil.com'));
    assert.ok(!origenPermitido(a, 'http://localhost:8080'));
    assert.ok(!origenPermitido(a, undefined));
    assert.ok(!asistentePorClave('constructor') && !asistentePorClave('__proto__') && !asistentePorClave('noexiste'));
  });
  await caso('inicioMesChile es medianoche del día 1 en Chile', () => {
    const d = inicioMesChile(new Date('2026-11-11T15:00:00Z'));
    assert.strictEqual(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(d).replace(/\D/g, ''), '0100');
    const j = inicioMesChile(new Date('2026-07-15T15:00:00Z'));
    assert.strictEqual(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(j).replace(/\D/g, ''), '0100');
  });

  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('mensaje válido: responde, canal web y teléfono web:<sesión>', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: '  Hola  ' });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.respuesta, 'Respuesta de prueba'); assert.strictEqual(r.json.derivado, false);
      assert.strictEqual(r.cors, ORIGEN);
      assert.strictEqual(motor.llamadas[0].canal, 'web'); assert.strictEqual(motor.llamadas[0].telefonoCliente, `web:${SES}`); assert.strictEqual(motor.llamadas[0].textoEntrante, 'Hola');
    });
    await caso('origen ajeno: 403 y sin CORS', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Hola' }, 'https://evil.com');
      assert.strictEqual(r.status, 403); assert.strictEqual(r.cors, null);
    });
    await caso('sin Origin (script de servidor): 403', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Hola' }, null);
      assert.strictEqual(r.status, 403);
    });
    await caso('clave desconocida: 403', async () => {
      assert.strictEqual((await post(s, { clave: 'otra', sesion: SES, texto: 'Hola' })).status, 403);
    });
    await caso('sesión inválida, vacío o muy largo: 400 sin llamar al motor', async () => {
      const antes = motor.llamadas.length;
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: 'corta', texto: 'Hola' })).status, 400);
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: '../../etc/passwd/xxxxxxx', texto: 'Hola' })).status, 400);
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: '   ' })).status, 400);
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: 'x'.repeat(801) })).status, 400);
      assert.strictEqual(motor.llamadas.length, antes);
    });
    s.close();
  }
  {
    const prisma = crearPrisma({ conversacionesDelMes: 150 }); const motor = crearMotor(prisma);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('tope del plan: conversación nueva no llega al motor', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Hola' });
      assert.strictEqual(r.json.limite, true); assert.ok(/wa\.me\/56966108858/.test(r.json.respuesta)); assert.strictEqual(motor.llamadas.length, 0);
    });
    await caso('tope del plan: una conversación ya iniciada sigue', async () => {
      prisma.convs.push({ telefono: `web:${SES}`, canal: 'web', mensajes: [{ rol: 'usuario' }], escaladoAHumano: false });
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Sigo' });
      assert.strictEqual(r.json.respuesta, 'Respuesta de prueba');
    });
    s.close();
  }
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma, { derivarAl: 2 });
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('al derivar: derivado=true, y luego texto fijo sin invitar a WhatsApp', async () => {
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: 'a' })).json.derivado, false);
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: 'b' })).json.derivado, true);
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'c' });
      assert.strictEqual(r.json.derivado, true); assert.ok(/tus datos/.test(r.json.respuesta) && !/wa\.me/.test(r.json.respuesta));
    });
    s.close();
  }
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    prisma.convs.push({ telefono: `web:${SES}`, canal: 'web', mensajes: Array.from({ length: 30 }, () => ({ rol: 'usuario' })), escaladoAHumano: false });
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('tope por sesión (30 mensajes): no llega al motor', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'otro' });
      assert.strictEqual(r.json.limite, true); assert.strictEqual(motor.llamadas.length, 0);
    });
    s.close();
  }
  {
    const prisma = crearPrisma(); const motor = async () => { throw new Error('falla simulada'); };
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('error del motor: 500 con texto amable y WhatsApp', async () => {
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Hola' });
      assert.strictEqual(r.status, 500); assert.ok(/wa\.me/.test(r.json.respuesta));
    });
    await caso('preflight OPTIONS y config', async () => {
      const base = `http://127.0.0.1:${s.address().port}/chat-web`;
      const pre = await fetch(`${base}/mensaje`, { method: 'OPTIONS', headers: { Origin: ORIGEN, 'Access-Control-Request-Method': 'POST' } });
      assert.strictEqual(pre.status, 204); assert.strictEqual(pre.headers.get('access-control-allow-origin'), ORIGEN);
      const cfg = await fetch(`${base}/config?clave=multidigital`, { headers: { Origin: ORIGEN } });
      const j = await cfg.json();
      assert.strictEqual(cfg.status, 200); assert.ok(j.titulo && j.saludo && j.color); assert.ok(!('empresaId' in j));
      const ajeno = await fetch(`${base}/config?clave=multidigital`, { headers: { Origin: 'https://evil.com' } });
      assert.strictEqual(ajeno.status, 403);
      const w = await fetch(`${base}/widget.js`);
      assert.strictEqual(w.status, 200); assert.ok((await w.text()).includes('asistenteWeb'));
    });
    s.close();
  }
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('máximo 5 conversaciones nuevas por IP al día', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await post(s, { clave: 'multidigital', sesion: `sesionnueva${i}xxxxxxxx`, texto: 'Hola' });
        assert.strictEqual(r.json.respuesta, 'Respuesta de prueba', `conversación ${i + 1}`);
      }
      const sexta = await post(s, { clave: 'multidigital', sesion: 'sesionnueva9xxxxxxxx', texto: 'Hola' });
      assert.strictEqual(sexta.json.limite, true);
      // Una ya abierta sigue respondiendo.
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: 'sesionnueva0xxxxxxxx', texto: 'Sigo' })).json.respuesta, 'Respuesta de prueba');
    });
    await caso('body de más de 4 KB: rechazado sin llegar al motor', async () => {
      const antes = motor.llamadas.length;
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'Hola', relleno: 'x'.repeat(5000) });
      assert.strictEqual(r.status, 413); assert.strictEqual(motor.llamadas.length, antes);
    });
    s.close();
  }
  await caso('WhatsApp nunca envía a un contacto "web:"', async () => {
    const { sendWhatsAppTextMessage } = require('../src/services/whatsapp');
    let llamoAMeta = false;
    const fetchOriginal = global.fetch;
    global.fetch = async () => { llamoAMeta = true; return { ok: true, json: async () => ({}) }; };
    try {
      await assert.rejects(sendWhatsAppTextMessage({ phoneNumberId: '1', to: `web:${SES}`, text: 'x', accessToken: 't' }), /chat web/);
    } finally { global.fetch = fetchOriginal; }
    assert.strictEqual(llamoAMeta, false);
  });
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma, { derivarAl: 2 });
    const avisos = [];
    const s = await servidor({ prisma, procesarMensajeEntrante: motor, avisarInteresado: (p) => avisos.push(p) });
    await caso('aviso al negocio: una sola vez, justo al derivar', async () => {
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'a' });
      assert.strictEqual(avisos.length, 0);
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'mis datos' });
      assert.strictEqual(avisos.length, 1);
      assert.strictEqual(avisos[0].telefonoCliente, `web:${SES}`); assert.strictEqual(avisos[0].asistente.titulo, 'Asistente Multidigital');
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'gracias' });
      assert.strictEqual(avisos.length, 1);
    });
    await caso('aviso de nuevo si vuelve después de reactivarse el bot y deja datos otra vez', async () => {
      // El job de pausa reactiva el bot borrando solo pausadaPorHumanoEn (escaladoAHumano queda en true).
      prisma.convs.find((c) => c.telefono === `web:${SES}`).pausadaPorHumanoEn = null;
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'volví, mis datos nuevos' });
      assert.strictEqual(avisos.length, 2);
    });
    s.close();
  }
  await caso('el nombre se limpia (sin saltos de línea y acotado) antes del asunto', async () => {
    const { avisarInteresadoWeb } = require('../src/lib/avisoInteresadoWeb');
    const prisma = { conversacion: { findFirst: async () => ({ mensajes: [{ rol: 'usuario', contenido: 'x' }] }) } };
    const enviados = [];
    await avisarInteresadoWeb({
      prisma, asistente: { titulo: 'X' }, empresaId: 'e', telefonoCliente: `web:${SES}`,
      deps: { resumir: async () => ({ nombre: `Ana\r\nBcc: otro\t${'x'.repeat(100)}` }), enviar: async (p) => enviados.push(p) },
    });
    const nombre = enviados[0].datos.nombre;
    assert.ok(!/[\r\n\t]/.test(nombre)); assert.ok(nombre.length <= 60); assert.ok(nombre.startsWith('Ana Bcc: otro'));
  });
  await caso('correo al negocio: datos, botón de WhatsApp y texto escapado', () => {
    const { armarCorreoInteresado } = require('../src/services/emailInteresadoWeb');
    const asistente = { titulo: 'Asistente IACE', nombreNegocio: 'IACE Ingeniería Eléctrica' };
    const { asunto, html } = armarCorreoInteresado({
      asistente,
      datos: { nombre: 'Juan Pérez', telefono: '56912345678', correo: 'juan@ejemplo.cl', necesidad: 'Tablero <urgente>' },
      mensajes: [{ rol: 'usuario', contenido: '<script>alert(1)</script> hola' }, { rol: 'asistente', contenido: 'Hola Juan' }, { rol: 'admin', contenido: 'interno' }],
      ahora: new Date('2026-11-11T18:00:00Z'),
    });
    assert.ok(asunto.includes('Juan Pérez'));
    assert.ok(html.includes('https://wa.me/56912345678?text=Hola%20Juan%2C%20te%20escribo%20de%20IACE'));
    assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
    assert.ok(html.includes('Tablero &lt;urgente&gt;'));
    assert.ok(!html.includes('interno'));
    const sinFono = armarCorreoInteresado({ asistente, datos: { nombre: null, telefono: null, telefonoEscrito: '123' }, mensajes: [] });
    assert.ok(sinFono.html.includes('No dejó un número de WhatsApp válido') && !sinFono.html.includes('wa.me'));
  });
  await caso('avisarInteresadoWeb normaliza el teléfono y nunca lanza', async () => {
    const { avisarInteresadoWeb } = require('../src/lib/avisoInteresadoWeb');
    const prisma = { conversacion: { findFirst: async () => ({ mensajes: [{ rol: 'usuario', contenido: 'Soy Ana, +56 9 1234 5678' }] }) } };
    const enviados = [];
    await avisarInteresadoWeb({
      prisma, asistente: { titulo: 'X' }, empresaId: 'e', telefonoCliente: `web:${SES}`,
      deps: { resumir: async () => ({ nombre: ' Ana ', telefono: '+56 9 1234 5678', necesidad: 'Cotizar' }), enviar: async (p) => enviados.push(p) },
    });
    assert.strictEqual(enviados.length, 1);
    assert.deepStrictEqual(enviados[0].datos, { nombre: 'Ana', telefono: '56912345678', telefonoEscrito: '+56 9 1234 5678', correo: null, necesidad: 'Cotizar' });
    await avisarInteresadoWeb({
      prisma, asistente: { titulo: 'X' }, empresaId: 'e', telefonoCliente: `web:${SES}`,
      deps: { resumir: async () => { throw new Error('Anthropic caído'); }, enviar: async () => {} },
    }); // no lanza
  });
  console.log(`\n${ok} casos OK`);
})().catch((e) => { console.error('FALLÓ:', e.message); process.exit(1); });
