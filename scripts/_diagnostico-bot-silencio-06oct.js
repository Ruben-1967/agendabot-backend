#!/usr/bin/env node
// Uso puntual (2026-10-06): Diego (Ahorróptica) reporta que el bot no agenda,
// no muestra las horas en la lista tocable, y que cuando alguien responde
// "sí asistiré" a un recordatorio el bot vuelve a preguntar qué servicio
// quiere agendar. Hipótesis 1: el crédito de Anthropic se agotó hoy y, como
// claude.js no captura errores, el webhook (server.js) los loguea y NO manda
// ninguna respuesta (silencio). Este script revisa las conversaciones reales
// de las últimas 48 h: (A) mensajes del cliente SIN respuesta del bot,
// agrupados por hora de Chile -- la firma de un corte; (B) respuestas del bot
// que preguntan por el servicio justo después de un mensaje de confirmación
// ("sí", "asistiré", "confirmo"...) -- el síntoma 3. Teléfonos enmascarados.
// Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-bot-silencio-06oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const HORAS = 48;
const REGEX_CONFIRMA = /\b(s[ií]|asistir[eé]|asistiremos|confirmo|confirmado|voy|ah[ií] estar[eé])\b/i;
const REGEX_PREGUNTA_SERVICIO = /(qu[eé] servicio|cu[aá]l servicio|servicio (deseas|quieres|necesitas)|agendar)/i;

const mask = (t) => `***${String(t).slice(-4)}`;
const horaChile = (iso) => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const recorte = (s, n = 110) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

// Casos puntuales dados por el dueño (2026-10-06): 1 = "el bot no agenda / no
// muestra la lista de horas", 2 = "respondió que sí asistirá al recordatorio y
// el bot volvió a preguntar qué servicio agendar". Se imprime la conversación
// completa, el estado de la reserva en curso y las citas del cliente.
const CASOS = [
  { etiqueta: 'CASO 1 (no agenda / sin lista de horas)', telefono: '56937546427' },
  { etiqueta: 'CASO 2 (confirma asistencia y el bot pregunta servicio)', telefono: '56979083454' },
];

async function detalleCaso({ etiqueta, telefono }) {
  console.log(`\n==================== ${etiqueta} -- ${telefono} ====================`);
  const conv = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: { endsWith: telefono.slice(-9) } } });
  if (!conv) { console.log('No se encontró conversación con ese teléfono.'); return; }
  console.log(`telefono guardado=${conv.telefono} | pausadaPorHumanoEn=${conv.pausadaPorHumanoEn} | actualizadoEn=${conv.actualizadoEn.toISOString()}`);
  console.log(`reservaEnCurso=${JSON.stringify(conv.reservaEnCurso)}`);
  const msgs = Array.isArray(conv.mensajes) ? conv.mensajes : [];
  console.log(`${msgs.length} mensaje(s) en total -- últimos 30:\n`);
  for (const m of msgs.slice(-30)) {
    console.log(`[${m.rol}] ${horaChile(m.timestamp)} | ${String(m.contenido || '').replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  const clientes = await prisma.cliente.findMany({ where: { empresaId: EMPRESA_ID, telefono: { endsWith: telefono.slice(-9) } }, select: { id: true, nombre: true, telefono: true } });
  for (const cl of clientes) {
    const citas = await prisma.cita.findMany({
      where: { clienteId: cl.id, fechaHoraInicio: { gte: new Date(Date.now() - 2 * 24 * 3600 * 1000) } },
      orderBy: { fechaHoraInicio: 'asc' },
      select: { id: true, estado: true, fechaHoraInicio: true, confirmacionIntentos: true, confirmacionUltimoEnvioEn: true, nombrePaciente: true },
    });
    console.log(`\nCliente ${cl.id} "${cl.nombre}" -- citas desde hace 2 días:`);
    for (const c of citas) console.log(`  · ${horaChile(c.fechaHoraInicio)} | ${c.estado} | intentos=${c.confirmacionIntentos} | últ. recordatorio=${c.confirmacionUltimoEnvioEn ? horaChile(c.confirmacionUltimoEnvioEn) : '-'} | paciente=${c.nombrePaciente || '-'}`);
    if (citas.length === 0) console.log('  (ninguna)');
  }
}

async function main() {
  for (const caso of CASOS) await detalleCaso(caso);
  console.log('\n\n######## BARRIDO GENERAL ########');
  const desde = new Date(Date.now() - HORAS * 3600 * 1000);
  const convs = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, actualizadoEn: { gte: desde } },
    select: { telefono: true, mensajes: true, pausadaPorHumanoEn: true },
  });
  console.log(`${convs.length} conversación(es) con actividad en las últimas ${HORAS} h.\n`);

  const sinRespuestaPorHora = {};
  const sinRespuestaDetalle = [];
  const sintoma3 = [];

  for (const c of convs) {
    const msgs = (Array.isArray(c.mensajes) ? c.mensajes : []).filter((m) => m.timestamp && new Date(m.timestamp) >= desde);
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.rol !== 'usuario') continue;
      const siguiente = msgs[i + 1];
      const hayRespuesta = siguiente && siguiente.rol !== 'usuario';
      const antiguoMin = (Date.now() - new Date(m.timestamp).getTime()) / 60000;
      if (!hayRespuesta && antiguoMin > 3 && !c.pausadaPorHumanoEn) {
        const h = horaChile(m.timestamp).slice(0, 8); // dd/mm, hh
        sinRespuestaPorHora[h] = (sinRespuestaPorHora[h] || 0) + 1;
        sinRespuestaDetalle.push(`${horaChile(m.timestamp)} ${mask(c.telefono)} cliente: "${recorte(m.contenido, 70)}"`);
      }
      if (hayRespuesta && REGEX_CONFIRMA.test(m.contenido || '') && REGEX_PREGUNTA_SERVICIO.test(siguiente.contenido || '')) {
        sintoma3.push(`${horaChile(m.timestamp)} ${mask(c.telefono)} cliente: "${recorte(m.contenido, 80)}" -> bot: "${recorte(siguiente.contenido, 120)}"`);
      }
    }
  }

  console.log('=== A. Mensajes del cliente SIN respuesta del bot (>3 min), por hora de Chile ===');
  const claves = Object.keys(sinRespuestaPorHora).sort();
  if (claves.length === 0) console.log('(ninguno)');
  for (const k of claves) console.log(`${k}h: ${sinRespuestaPorHora[k]}`);
  console.log('\nÚltimos 15 sin respuesta:');
  for (const d of sinRespuestaDetalle.slice(-15)) console.log(' ', d);

  console.log(`\n=== B. El bot pregunta por el servicio justo tras un "sí/asistiré/confirmo" (${sintoma3.length}) ===`);
  for (const s of sintoma3.slice(-15)) console.log(' ', s);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
