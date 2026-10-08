#!/usr/bin/env node
// Uso puntual (2026-10-08): el dueño reporta que los mensajes SÍ llegan al
// WhatsApp 56927602910 (el de la tienda luxvision.cl) pero el chat automático
// no responde. Este script, SOLO LECTURA, revisa las causas más probables:
//   1. ¿Qué Empresa de la plataforma tiene ese número (o se llama LuxVision)?
//   2. ¿Está bloqueada (prueba vencida / sin suscripción) o inactiva?
//   3. ¿El token de Meta sigue siendo válido? (consulta GET al número, no manda nada)
//   4. ¿Llegan mensajes y el bot los responde? (últimas 72 h, teléfonos enmascarados)
//   5. ¿Hay fallas de entrega registradas?
// Nunca imprime el token ni manda ningún mensaje.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-chat-luxvision-08oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const NUMERO = '927602910';
const HORAS = 72;
const GRAPH = 'v21.0';
const mask = (t) => `***${String(t).slice(-4)}`;
const horaChile = (d) => new Date(d).toLocaleString('es-CL', { timeZone: 'America/Santiago', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

async function revisarToken(empresa) {
  if (!empresa.whatsappNumeroId || !empresa.whatsappToken) {
    console.log('  Meta: falta whatsappNumeroId o whatsappToken -- esta Empresa NO está conectada a la API de WhatsApp.');
    return;
  }
  try {
    const url = `https://graph.facebook.com/${GRAPH}/${empresa.whatsappNumeroId}?fields=display_phone_number,verified_name,quality_rating,status,platform_type,account_mode`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${empresa.whatsappToken}` } });
    const data = await res.json();
    if (!res.ok) {
      console.log(`  Meta: ERROR ${res.status} -- ${data.error?.message || JSON.stringify(data).slice(0, 200)} (código ${data.error?.code ?? '-'}${data.error?.code === 190 ? ' = TOKEN VENCIDO O REVOCADO' : ''})`);
      return;
    }
    console.log(`  Meta: OK -- número ${data.display_phone_number} | nombre verificado "${data.verified_name}" | calidad ${data.quality_rating} | status ${data.status} | plataforma ${data.platform_type} | modo ${data.account_mode}`);
  } catch (err) {
    console.log(`  Meta: no se pudo consultar (${err.message})`);
  }
}

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: {
      OR: [
        { whatsappPhoneNumber: { contains: NUMERO } },
        { nombre: { contains: 'luxvision', mode: 'insensitive' } },
      ],
    },
    include: { suscripcion: true },
  });
  console.log(`Empresas encontradas: ${empresas.length}`);
  if (empresas.length === 0) {
    console.log('Ninguna Empresa tiene ese número ni se llama LuxVision: el chat que no responde NO es de esta plataforma (sería un servicio de terceros).');
    return;
  }

  const desde = new Date(Date.now() - HORAS * 3600 * 1000);
  for (const e of empresas) {
    console.log(`\n==================== ${e.nombre}${e.sucursal ? ' · ' + e.sucursal : ''} (${e.id}) ====================`);
    console.log(`  activo=${e.activo} | esDemo=${e.esDemo} | whatsappPhoneNumber=${e.whatsappPhoneNumber || '(vacío)'} | bloqueadaPorPruebaVencida=${e.bloqueadaPorPruebaVencida}`);
    const clavesEstado = Object.keys(e).filter((k) => /prueba|trial|bloque|pausa|vence/i.test(k) && k !== 'bloqueadaPorPruebaVencida');
    for (const k of clavesEstado) console.log(`  ${k}=${e[k] instanceof Date ? e[k].toISOString() : JSON.stringify(e[k])}`);
    console.log(`  BLOQUEO_PRUEBA_VENCIDA_ACTIVO (variable de entorno) = ${process.env.BLOQUEO_PRUEBA_VENCIDA_ACTIVO || '(no definida = apagado)'}`);
    const s = e.suscripcion;
    console.log(`  Suscripción: ${s ? `estado=${s.estado} plan=${s.plan} exentoDePlan=${s.exentoDePlan} mesesGratisPlan=${s.mesesGratisPlan}` : '(ninguna)'}`);
    console.log(`  Token de Meta guardado: ${e.whatsappToken ? 'sí' : 'no'} | whatsappNumeroId: ${e.whatsappNumeroId || '(vacío)'}`);
    await revisarToken(e);

    const convs = await prisma.conversacion.findMany({
      where: { empresaId: e.id, actualizadoEn: { gte: desde } },
      select: { telefono: true, mensajes: true, pausadaPorHumanoEn: true, actualizadoEn: true },
      orderBy: { actualizadoEn: 'desc' },
      take: 40,
    });
    console.log(`\n  Conversaciones con actividad en las últimas ${HORAS} h: ${convs.length}`);
    let sinRespuesta = 0;
    for (const c of convs) {
      const msgs = Array.isArray(c.mensajes) ? c.mensajes : [];
      const ultimo = msgs[msgs.length - 1];
      if (ultimo?.rol === 'usuario' || ultimo?.rol === 'cliente') sinRespuesta++;
    }
    console.log(`  ...cuyo ÚLTIMO mensaje es del cliente (sin respuesta del bot): ${sinRespuesta}`);
    for (const c of convs.slice(0, 5)) {
      const msgs = Array.isArray(c.mensajes) ? c.mensajes : [];
      const ult = msgs.slice(-3).map((m) => `[${m.rol}] ${horaChile(m.timestamp)} ${String(m.contenido || '').replace(/\s+/g, ' ').slice(0, 90)}`);
      console.log(`  · ${mask(c.telefono)} | pausadaPorHumano=${c.pausadaPorHumanoEn ? horaChile(c.pausadaPorHumanoEn) : 'no'} | última actividad ${horaChile(c.actualizadoEn)}`);
      for (const l of ult) console.log(`      ${l}`);
    }

    const fallas = await prisma.fallaEnvioWhatsApp.findMany({ where: { empresaId: e.id, creadoEn: { gte: desde } }, orderBy: { creadoEn: 'desc' }, take: 5 });
    console.log(`\n  Fallas de entrega WhatsApp (${HORAS} h): ${fallas.length}`);
    for (const f of fallas) console.log(`   · ${horaChile(f.creadoEn)} ${mask(f.telefono)} código=${f.errorCodigo} ${String(f.errorMensaje || '').slice(0, 120)}`);
  }
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
