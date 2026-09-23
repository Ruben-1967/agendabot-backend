// src/jobs/chequeoSaludDiario.js
//
// Chequeo diario del sistema, pensado para anticiparse a que los clientes
// reporten problemas en vez de enterarnos por ellos (pedido explícito
// 2026-09-23, tras una seguidilla de bugs reales encontrados primero por
// Ahorróptica). Revisa señales REALES ya vistas fallar en producción este
// mes -- no es un chequeo genérico, cada punto corresponde a un incidente
// real ya ocurrido:
//
//   A. Fallas de entrega de WhatsApp (últimas 24h) -- ver
//      FallaEnvioWhatsApp en server.js (webhook "statuses"). Caso real:
//      Ahorróptica, error 131042 (falta método de pago), 2026-09-22.
//   B. Cliente con teléfono mal formado + Cita PENDIENTE futura -- mismo
//      criterio que scripts/_detectar-clientes-telefono-mal-formado-riesgo-real.js.
//      Caso real: Diego, Ahorróptica, 2026-09-22/23.
//   C. Citas a un intento de auto-cancelarse por falta de confirmación
//      (confirmacionIntentos=3) -- señal de que el ciclo de recordatorios
//      no está siendo respondido, vale la pena que alguien llame al cliente.
//   D. Reservas en curso abandonadas (sin actividad 3h+, ver
//      flujoReserva.js#reservaAbandonada) que siguen colgando ahora mismo
//      -- no es necesariamente un problema (el fix las descarta solas en
//      el próximo mensaje del cliente), pero un número alto y persistente
//      día a día sería señal de que algo más está pasando.
//
// Solo lectura -- nunca repara nada automáticamente, solo avisa. Corre
// como node-cron autoprogramado DENTRO del proceso web (mismo patrón que
// pausaCoexistence.js/enviarPreguntaOptIn.js), a las 08:00 hora de Chile
// (el paquete node-cron maneja el cambio de horario de verano solo, vía
// la opción timezone).
//
// Notificación por WhatsApp SOLO si hay algo que reportar (evita fatiga de
// alertas) -- a ALERTA_SALUD_TELEFONO (env var, número del administrador
// que debe recibir el aviso), usando la plantilla aprobada
// "chequeo_salud_sistema" (ver scripts/crear-plantilla-chequeo-salud.js).
// El detalle completo SIEMPRE queda en los logs de Render, exista o no
// ALERTA_SALUD_TELEFONO configurada.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');

const HORAS_VENTANA_FALLAS = 24;
const HORAS_ABANDONO = 3; // debe calzar con flujoReserva.js#HORAS_MAX_INACTIVIDAD_RESERVA
const PLANTILLA_ALERTA = 'chequeo_salud_sistema';

function pareceFormatoMetaValido(telefono) {
  return /^\d{8,15}$/.test(telefono || '');
}

async function chequeoA_FallasWhatsApp(desde) {
  const fallas = await prisma.fallaEnvioWhatsApp.findMany({
    where: { creadoEn: { gte: desde } },
    include: { empresa: { select: { nombre: true } } },
  });
  if (fallas.length === 0) {
    return { ok: true, resumen: 'Sin fallas de entrega de WhatsApp en las últimas 24h.' };
  }
  const porEmpresa = {};
  for (const f of fallas) {
    const nombre = f.empresa?.nombre || f.empresaId;
    porEmpresa[nombre] = (porEmpresa[nombre] || 0) + 1;
  }
  const detalle = Object.entries(porEmpresa).map(([nombre, n]) => `${nombre}: ${n}`).join(', ');
  return { ok: false, resumen: `${fallas.length} falla(s) de entrega de WhatsApp en 24h -- ${detalle}.` };
}

async function chequeoB_TelefonoMalFormadoConCitaFutura() {
  const empresasConRut = await prisma.empresa.findMany({ where: { requiereRut: true }, select: { id: true, nombre: true } });
  const ahora = new Date();
  const urgentes = [];

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        citas: { some: { estado: 'PENDIENTE', fechaHoraInicio: { gt: ahora } } },
      },
      select: { nombre: true, telefono: true },
    });
    const malFormados = candidatos.filter((c) => !pareceFormatoMetaValido(c.telefono));
    for (const c of malFormados) {
      urgentes.push(`${c.nombre} (${empresa.nombre})`);
    }
  }

  if (urgentes.length === 0) {
    return { ok: true, resumen: 'Sin clientes en riesgo (teléfono mal formado + cita pendiente futura).' };
  }
  return { ok: false, resumen: `${urgentes.length} cliente(s) con cita pendiente que probablemente no puedan confirmar por WhatsApp: ${urgentes.join(', ')}. Ver scripts/_detectar-clientes-telefono-mal-formado-riesgo-real.js para el detalle.` };
}

async function chequeoC_CitasAPuntoDeAutoCancelar() {
  const citas = await prisma.cita.findMany({
    where: { estado: 'PENDIENTE', confirmacionIntentos: 3 },
    include: { empresa: { select: { nombre: true } }, cliente: { select: { nombre: true } } },
  });
  if (citas.length === 0) {
    return { ok: true, resumen: 'Ninguna cita a punto de cancelarse por falta de confirmación.' };
  }
  const detalle = citas.map((c) => `${c.nombrePaciente || c.cliente?.nombre || 'sin nombre'} (${c.empresa.nombre})`).join(', ');
  return { ok: false, resumen: `${citas.length} cita(s) en el último aviso antes de cancelarse automáticamente: ${detalle}.` };
}

const TOPE_CONVERSACIONES_REVISADAS = 500;

async function chequeoD_ReservasAbandonadasActivas() {
  const desde = new Date(Date.now() - HORAS_ABANDONO * 60 * 60 * 1000);
  // reservaEnCurso no tiene índice propio -- esto es un recorrido completo
  // de Conversacion con reservaEnCurso no nulo. Hoy el conjunto es chico,
  // pero se pone un tope de seguridad para que nunca se vuelva una consulta
  // pesada dentro del mismo proceso que sirve HTTP en vivo, aunque la base
  // de clientes crezca mucho (hallazgo de revisión 2026-09-23). Si se llega
  // al tope, el conteo es un mínimo, no el total exacto -- se avisa en el
  // resumen.
  const conversaciones = await prisma.conversacion.findMany({
    where: { reservaEnCurso: { not: null } },
    select: { mensajes: true },
    take: TOPE_CONVERSACIONES_REVISADAS,
  });
  let colgadas = 0;
  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo?.timestamp && new Date(ultimo.timestamp) < desde) colgadas++;
  }
  const tocoElTope = conversaciones.length === TOPE_CONVERSACIONES_REVISADAS;
  // Informativo -- nunca marca ok:false por sí solo (el fix de hoy ya las
  // descarta en el próximo mensaje del cliente, no es una falla activa).
  return {
    ok: true,
    resumen: `${colgadas}${tocoElTope ? '+' : ''} reserva(s) en curso sin actividad hace más de ${HORAS_ABANDONO}h (se descartan solas en el próximo mensaje del cliente)${tocoElTope ? ` -- se revisaron solo las primeras ${TOPE_CONVERSACIONES_REVISADAS}` : ''}.`,
  };
}

async function ejecutarChequeoSaludDiario() {
  const desde24h = new Date(Date.now() - HORAS_VENTANA_FALLAS * 60 * 60 * 1000);
  const resultados = {
    'A. Fallas de entrega WhatsApp (24h)': await chequeoA_FallasWhatsApp(desde24h),
    'B. Clientes en riesgo (teléfono + cita pendiente)': await chequeoB_TelefonoMalFormadoConCitaFutura(),
    'C. Citas a punto de auto-cancelarse': await chequeoC_CitasAPuntoDeAutoCancelar(),
    'D. Reservas abandonadas activas (informativo)': await chequeoD_ReservasAbandonadasActivas(),
  };

  const fallas = Object.entries(resultados).filter(([, r]) => !r.ok);

  console.log('\n[CHEQUEO-SALUD-DIARIO] ' + new Date().toISOString());
  for (const [nombre, r] of Object.entries(resultados)) {
    console.log(`  ${r.ok ? '✅' : '⚠️ '} ${nombre}: ${r.resumen}`);
  }

  if (fallas.length === 0) {
    console.log('[CHEQUEO-SALUD-DIARIO] Todo OK, no se manda alerta.');
    return;
  }

  const telefonoAlerta = process.env.ALERTA_SALUD_TELEFONO;
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  if (!telefonoAlerta || !phoneNumberId || !accessToken) {
    console.warn('[CHEQUEO-SALUD-DIARIO] Hay problemas que reportar, pero falta ALERTA_SALUD_TELEFONO/DEMO_PHONE_NUMBER_ID/DEMO_WHATSAPP_ACCESS_TOKEN -- no se pudo avisar por WhatsApp, revisar logs.');
    return;
  }

  try {
    await sendWhatsAppTemplateMessage({
      phoneNumberId,
      to: telefonoAlerta,
      templateName: PLANTILLA_ALERTA,
      variables: [String(fallas.length)],
      accessToken,
    });
    console.log(`[CHEQUEO-SALUD-DIARIO] Alerta enviada a ${telefonoAlerta} (${fallas.length} problema(s)).`);
  } catch (error) {
    console.error('[CHEQUEO-SALUD-DIARIO] Error enviando la alerta por WhatsApp:', error.message);
  }
}

// 08:00 hora de Chile, todos los días -- timezone explícito para que
// node-cron maneje el cambio de horario de verano solo.
cron.schedule('0 8 * * *', () => {
  ejecutarChequeoSaludDiario().catch((error) => {
    console.error('[CHEQUEO-SALUD-DIARIO] Error en el ciclo del job:', error);
  });
}, { timezone: 'America/Santiago' });

console.log('[CHEQUEO-SALUD-DIARIO] Job de chequeo diario programado (08:00 hora de Chile).');

module.exports = { ejecutarChequeoSaludDiario };
