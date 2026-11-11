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
      updateMany: async ({ where, data }) => {
        const c = convs.find((x) => x.telefono === where.telefono && x.canal === where.canal);
        if (c) Object.assign(c, data);
        return { count: c ? 1 : 0 };
      },
    },
  };
}
// Motor simulado: guarda el turno como lo haría chatbotEngine.
// derivarEn: números de turno (1, 2, ...) en que el asistente deriva.
function crearMotor(prisma, { derivarAl = null, derivarEn = null, respuesta = 'Respuesta de prueba' } = {}) {
  const llamadas = [];
  const turnos = derivarEn || (derivarAl ? [derivarAl] : []);
  const fn = async (p) => {
    llamadas.push(p);
    let c = prisma.convs.find((x) => x.telefono === p.telefonoCliente);
    if (!c) { c = { telefono: p.telefonoCliente, canal: p.canal, mensajes: [], escaladoAHumano: false }; prisma.convs.push(c); }
    // Como chatbotEngine: con el bot silenciado (pausa) no responde. En el canal web derivar
    // ya NO pausa: marca escaladoAHumano y devuelve escalado: true en ese turno.
    if (c.pausadaPorHumanoEn) return { respuestaTexto: null };
    c.mensajes.push({ rol: 'usuario', contenido: p.textoEntrante }, { rol: 'asistente', contenido: respuesta });
    const escalado = turnos.includes(c.mensajes.length / 2);
    if (escalado) c.escaladoAHumano = true;
    return { respuestaTexto: respuesta, escalado };
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
    await caso('al derivar: derivado=true y el asistente SIGUE conversando después', async () => {
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: 'a' })).json.derivado, false);
      assert.strictEqual((await post(s, { clave: 'multidigital', sesion: SES, texto: 'b' })).json.derivado, true);
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: '¿cuándo me llaman?' });
      assert.strictEqual(r.json.respuesta, 'Respuesta de prueba'); assert.strictEqual(r.json.derivado, false);
      assert.strictEqual(motor.llamadas.length, 3);
    });
    await caso('bot silenciado: texto fijo sin invitar a WhatsApp', async () => {
      prisma.convs.find((c) => c.telefono === `web:${SES}`).pausadaPorHumanoEn = new Date();
      const r = await post(s, { clave: 'multidigital', sesion: SES, texto: 'hola?' });
      assert.ok(/tus datos/.test(r.json.respuesta) && !/wa\.me/.test(r.json.respuesta));
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
    const prisma = crearPrisma(); const motor = crearMotor(prisma, { derivarEn: [2, 4, 5] });
    const avisos = [];
    const s = await servidor({ prisma, procesarMensajeEntrante: motor, avisarInteresado: (p) => avisos.push(p) });
    await caso('aviso al negocio: al derivar, y no se repite si vuelve a derivar enseguida', async () => {
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'a' });
      assert.strictEqual(avisos.length, 0);
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'mis datos' });
      assert.strictEqual(avisos.length, 1);
      assert.strictEqual(avisos[0].telefonoCliente, `web:${SES}`); assert.strictEqual(avisos[0].asistente.titulo, 'Asistente Multidigital');
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'gracias' });
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'deriva otra vez' }); // turno 4: deriva de nuevo
      assert.strictEqual(avisos.length, 1);
    });
    await caso('aviso de nuevo si vuelve a derivar pasadas 6 horas', async () => {
      prisma.convs.find((c) => c.telefono === `web:${SES}`).alertaUrgenteEnviadaEn = new Date(Date.now() - 7 * 3600000);
      await post(s, { clave: 'multidigital', sesion: SES, texto: 'volví, mis datos nuevos' }); // turno 5
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
  await caso('asistentes desde la base: activo, inactivo, caché y respaldo si la base falla', async () => {
    const { crearBuscadorAsistentes } = require('../src/lib/asistenteWeb');
    const filas = {
      iace: { clave: 'iace', empresaId: 'emp-iace', activo: true, titulo: 'Asistente IACE', nombreNegocio: 'IACE', saludo: 'Hola', color: '#123456', whatsapp: '56964256705', origenes: ['IACE.cl', 'www.iace.cl'], correoAvisos: ['a@iace.cl'], conversacionesMes: 150 },
      apagado: { clave: 'apagado', empresaId: 'x', activo: false, titulo: 't', nombreNegocio: 'n', saludo: 's', color: '#000', origenes: [], correoAvisos: [], conversacionesMes: 150 },
    };
    let lecturas = 0; let reloj = 0;
    const prisma = { asistenteWeb: { findUnique: async ({ where }) => { lecturas++; return filas[where.clave] || null; } } };
    const buscar = crearBuscadorAsistentes(prisma, { ahora: () => reloj });
    const a = await buscar('IACE');
    assert.strictEqual(a.empresaId, 'emp-iace'); assert.deepStrictEqual(a.origenes, ['iace.cl', 'www.iace.cl']);
    assert.ok(origenPermitido(a, 'https://iace.cl') && !origenPermitido(a, 'https://multidigital.cl'));
    await buscar('iace'); assert.strictEqual(lecturas, 1); // caché
    reloj = 61000; await buscar('iace'); assert.strictEqual(lecturas, 2); // caché vencida
    assert.strictEqual(await buscar('apagado'), null);
    assert.strictEqual((await buscar('multidigital')).titulo, 'Asistente Multidigital'); // respaldo fijo
    assert.strictEqual(await buscar('../x'), null); assert.strictEqual(lecturas, 4);
    const caida = crearBuscadorAsistentes({ asistenteWeb: { findUnique: async () => { throw new Error('sin base'); } } });
    assert.strictEqual((await caida('multidigital')).titulo, 'Asistente Multidigital');
    assert.strictEqual(await caida('iace'), null);
  });
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    const buscarAsistente = async (c) => (c === 'iace' ? { titulo: 'Asistente IACE', nombreNegocio: 'IACE <Ingeniería>', correoAvisos: ['a@iace.cl'], origenes: ['iace.cl'] } : null);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor, buscarAsistente });
    await caso('aviso de privacidad: por negocio, escapado, y 404 si no existe', async () => {
      const base = `http://127.0.0.1:${s.address().port}/chat-web/privacidad`;
      const r = await fetch(`${base}?clave=iace`); const html = await r.text();
      assert.strictEqual(r.status, 200); assert.ok(html.includes('IACE &lt;Ingeniería&gt;') && !html.includes('<Ingeniería>'));
      assert.ok(html.includes('mailto:a@iace.cl') && html.includes('inteligencia artificial'));
      assert.strictEqual((await fetch(`${base}?clave=otra`)).status, 404);
    });
    s.close();
  }
  await caso('alta: valida el archivo del cliente y arma sitios con y sin www', () => {
    const fs = require('fs'); const os = require('os'); const path = require('path');
    const { leerDatos } = require('./alta-asistente-web');
    const escribir = (o) => { const f = path.join(os.tmpdir(), `alta-prueba-${Object.keys(o).length}-${o.clave || 'x'}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
    const base = { clave: 'iace', nombreNegocio: 'IACE Ingeniería Eléctrica', sitios: ['https://www.iace.cl/'], correoAvisos: ['Contacto@IACE.cl'], whatsapp: '+56 9 6425 6705', mesesGratis: 3, informacion: 'x'.repeat(100) };
    const d = leerDatos(escribir(base));
    assert.deepStrictEqual(d.origenes.sort(), ['iace.cl', 'www.iace.cl']);
    assert.strictEqual(d.whatsapp, '56964256705'); assert.deepStrictEqual(d.correoAvisos, ['contacto@iace.cl']);
    assert.strictEqual(d.conversacionesMes, 150); assert.ok(d.gratisHasta instanceof Date);
    assert.ok(d.guion.includes('IACE Ingeniería Eléctrica') && d.guion.includes('WhatsApp'));
    assert.throws(() => leerDatos(escribir({ ...base, clave: 'Mal Clave', correoAvisos: ['no-es-correo'], informacion: 'corta', sitios: [] })), /clave[\s\S]*informacion[\s\S]*sitios[\s\S]*correoAvisos/);
    assert.strictEqual(leerDatos(escribir({ ...base, plan: 'pro' })).conversacionesMes, 400);
    assert.throws(() => leerDatos(escribir({ ...base, clave: 'multidigital' })), /reservada/);
    assert.ok(!('telefonoContacto' in d), 'el alta no debe poner telefonoContacto (alertas por WhatsApp)');
  });
  await caso('alta: el fin del período gratis no se pasa de mes', () => {
    const { sumarMeses } = require('./alta-asistente-web');
    const f = (s) => sumarMeses(new Date(s), 3);
    assert.strictEqual(f('2026-11-30T12:00:00').getMonth(), 1); assert.strictEqual(f('2026-11-30T12:00:00').getDate(), 28);
    assert.strictEqual(f('2026-11-11T12:00:00').getMonth(), 1); assert.strictEqual(f('2026-11-11T12:00:00').getDate(), 11);
  });
  {
    const prisma = crearPrisma(); const motor = crearMotor(prisma);
    const s = await servidor({ prisma, procesarMensajeEntrante: motor });
    await caso('privacidad de Multidigital: responsable Multidigital, sin "por encargo de Multidigital"', async () => {
      const html = await (await fetch(`http://127.0.0.1:${s.address().port}/chat-web/privacidad?clave=multidigital`)).text();
      assert.ok(html.includes('<b>Multidigital</b> (multidigital.cl) es responsable'));
      assert.ok(!html.includes('por encargo de Multidigital') && !html.includes('copia a Multidigital'));
    });
    s.close();
  }
  console.log(`\n${ok} casos OK`);
})().catch((e) => { console.error('FALLÓ:', e.message); process.exit(1); });
