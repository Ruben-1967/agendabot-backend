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
//   E. Respuestas del bot con señales de problema (últimas 24h) -- no mide
//      "calidad" en general (no hay forma barata de saber si una respuesta
//      es correcta sin leerla), pero sí detecta las 2 firmas concretas que
//      ya vimos en incidentes reales: el fallback determinista de
//      "Disculpa, tuve un problema procesando tu solicitud" (ver
//      PLANTILLAS_DETERMINISTAS en flujoReserva.js -- el bot se quedó sin
//      poder avanzar) y el mismo mensaje del bot repetido 3+ veces seguidas
//      en la misma conversación (el patrón de Diego, Ahorróptica:
//      reservaEnCurso vieja secuestrando mensajes nuevos). Ambas son
//      búsquedas de texto sobre conversaciones reales (esDemo: false),
//      nunca sobre la demo.
//   F. Simulación de conversación sintética (proactivo, no reactivo --
//      pedido explícito 2026-09-23: "no es necesario que corra para todos
//      los clientes, bastaría con crear algunas conversaciones ficticias y
//      parametrizar lo que debería responder el bot"). Corre un flujo de
//      agendamiento COMPLETO contra el negocio de demo (Empresa.esDemo:
//      true), con un teléfono fijo dedicado, llamando directo a
//      procesarMensajeEntrante/procesarSeleccionInteractiva (mismo mecanismo
//      que los scripts _probar-*.js de esta sesión) -- nunca manda un
//      WhatsApp real, esas funciones solo devuelven el texto de respuesta.
//      Verifica 3 cosas concretas que ya fallaron en producción: (1) el
//      flujo completo termina en "agendada exitosamente", (2) si hay 2+
//      servicios, el bot ofrece los REALES configurados, nunca inventados,
//      (3) ninguna respuesta vosea (regla del system prompt, ver
//      _probar-nunca-vosea.js). Limpia la Cita/Cliente/Conversacion de
//      prueba siempre, incluso si algo falla a mitad de camino.
//
// Solo lectura -- nunca repara nada automáticamente, solo avisa. Corre
// como node-cron autoprogramado DENTRO del proceso web (mismo patrón que
// pausaCoexistence.js/enviarPreguntaOptIn.js), a las 08:00 hora de Chile
// (el paquete node-cron maneja el cambio de horario de verano solo, vía
// la opción timezone).
//
// Notificación por WhatsApp TODOS los días, haya o no algo que reportar
// (pedido explícito 2026-09-23 -- también sirve de "latido": si el mensaje
// no llega un día, es señal de que el job dejó de correr, no de que todo
// esté bien) -- a ALERTA_SALUD_TELEFONO (env var, número del administrador
// que debe recibir el aviso), usando la plantilla aprobada
// "chequeo_salud_sistema" (ver scripts/crear-plantilla-chequeo-salud.js).
// El detalle completo SIEMPRE queda en los logs de Render, exista o no
// ALERTA_SALUD_TELEFONO configurada.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { PLANTILLAS_DETERMINISTAS } = require('../services/flujoReserva');
const { procesarMensajeEntrante, procesarSeleccionInteractiva } = require('../services/chatbotEngine');
const { obtenerProximosDiasConDisponibilidad } = require('../services/disponibilidad');

const HORAS_VENTANA_FALLAS = 24;
const HORAS_ABANDONO = 3; // debe calzar con flujoReserva.js#HORAS_MAX_INACTIVIDAD_RESERVA
const PLANTILLA_ALERTA = 'chequeo_salud_sistema';
const TEXTO_FALLBACK_DETERMINISTA = PLANTILLAS_DETERMINISTAS.CONFIRMAR; // "Disculpa, tuve un problema procesando tu solicitud..."
const VECES_REPETIDO_SOSPECHOSO = 3; // mismo mensaje del bot 3+ veces seguidas = señal de bucle (caso Diego)

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

async function chequeoE_RespuestasBotConSenalesDeProblema(desde) {
  const empresasReales = await prisma.empresa.findMany({ where: { esDemo: false }, select: { id: true, nombre: true } });
  const empresaPorId = new Map(empresasReales.map((e) => [e.id, e.nombre]));

  // Filtra por actualizadoEn (>=desde) a nivel de base de datos -- una
  // Conversacion solo se actualiza cuando se le agrega un mensaje, así que
  // esto ya acota a "conversaciones con actividad en las últimas 24h" antes
  // de traer las filas. El tope sigue existiendo como segunda red de
  // seguridad (mismo patrón que el chequeo D), pero ordenado por lo más
  // reciente primero -- sin esto, un `take` sin orden podría traer puras
  // conversaciones viejas y no detectar ninguna señal reciente real
  // (hallazgo de revisión 2026-09-23).
  const conversaciones = await prisma.conversacion.findMany({
    where: {
      empresaId: { in: empresasReales.map((e) => e.id) },
      actualizadoEn: { gte: desde },
    },
    select: { empresaId: true, clienteId: true, mensajes: true },
    orderBy: { actualizadoEn: 'desc' },
    take: TOPE_CONVERSACIONES_REVISADAS,
  });
  const tocoElTope = conversaciones.length === TOPE_CONVERSACIONES_REVISADAS;

  let fallbacks = 0;
  let bucles = 0;
  const detalleFallback = [];
  const detalleBucle = [];

  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    const empresaNombre = empresaPorId.get(conv.empresaId) || conv.empresaId;
    const recientes = mensajes.filter((m) => m?.rol === 'asistente' && m?.timestamp && new Date(m.timestamp) >= desde);

    if (recientes.some((m) => m.contenido === TEXTO_FALLBACK_DETERMINISTA)) {
      fallbacks++;
      detalleFallback.push(empresaNombre);
    }

    let seguidas = 1;
    for (let i = 1; i < recientes.length; i++) {
      if (recientes[i].contenido === recientes[i - 1].contenido) {
        seguidas++;
        if (seguidas === VECES_REPETIDO_SOSPECHOSO) {
          bucles++;
          detalleBucle.push(empresaNombre);
          break;
        }
      } else {
        seguidas = 1;
      }
    }
  }

  const sufijoTope = tocoElTope ? ` (se revisaron solo las primeras ${TOPE_CONVERSACIONES_REVISADAS} conversaciones)` : '';
  if (fallbacks === 0 && bucles === 0) {
    return { ok: true, resumen: `Sin señales de fallback ni de bucle en las respuestas del bot (24h)${sufijoTope}.` };
  }
  const partes = [];
  if (fallbacks > 0) partes.push(`${fallbacks} conversación(es) con el mensaje de fallback ("${TEXTO_FALLBACK_DETERMINISTA}") -- ${detalleFallback.join(', ')}`);
  if (bucles > 0) partes.push(`${bucles} conversación(es) con el mismo mensaje del bot repetido ${VECES_REPETIDO_SOSPECHOSO}+ veces seguidas -- ${detalleBucle.join(', ')}`);
  return { ok: false, resumen: partes.join('; ') + sufijoTope + '.' };
}

const TELEFONO_SIMULACION = '569000099999'; // fijo, dedicado a este chequeo -- nunca generado, nunca reasignado
const REGEX_VOSEO = /\b(vos|ten[eé]s|pod[eé]s|quer[eé]s|necesitás|sos\b|and[aá]\b|andate|fijate|escribime|decime|contame|mandame)\b/i;

async function limpiarConversacionSintetica(empresaId) {
  // Cada paso se intenta de forma independiente (hallazgo de revisión
  // 2026-09-23): si borrar la Cita fallara, igual queremos intentar borrar
  // el Cliente y la Conversacion, en vez de dejarlos huérfanos por un solo
  // paso fallido a mitad de camino.
  const cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono: TELEFONO_SIMULACION } });
  if (cliente) {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } }).catch((error) => {
      console.error('[CHEQUEO-SALUD-DIARIO] No se pudo borrar la(s) Cita(s) sintética(s):', error.message);
    });
    await prisma.cliente.delete({ where: { id: cliente.id } }).catch((error) => {
      console.error('[CHEQUEO-SALUD-DIARIO] No se pudo borrar el Cliente sintético:', error.message);
    });
  }
  await prisma.conversacion.deleteMany({ where: { empresaId, telefono: TELEFONO_SIMULACION } }).catch((error) => {
    console.error('[CHEQUEO-SALUD-DIARIO] No se pudo borrar la Conversacion sintética:', error.message);
  });
}

async function chequeoF_SimulacionConversacionSintetica() {
  const empresaDemo = await prisma.empresa.findFirst({ where: { esDemo: true } });
  if (!empresaDemo) {
    return { ok: true, resumen: 'Sin negocio de demo en este entorno -- chequeo omitido.' };
  }
  // Resguardo explícito (hallazgo de revisión 2026-09-23): la Cita sintética
  // queda PENDIENTE en la base los segundos entre crearse y limpiarse, y
  // confirmarCitasProximas.js (Render Cron Job aparte, cada 15-20min) barre
  // TODAS las Cita PENDIENTE sin filtrar por empresa -- pero ese job ya se
  // salta cualquier Cita cuya Empresa no tenga whatsappNumeroId propio
  // (confirmarCitasProximas.js:67), y un negocio demo nunca tiene WhatsApp
  // real conectado (demos.js nunca escribe ese campo). Este chequeo extra
  // no depende de esa inferencia -- si alguna vez cambiara, se salta solo.
  if (empresaDemo.whatsappNumeroId) {
    return { ok: true, resumen: `"${empresaDemo.nombre}" es demo pero tiene WhatsApp real conectado -- chequeo omitido por seguridad (no debería pasar).` };
  }

  const paramsBase = { empresa: empresaDemo, telefonoCliente: TELEFONO_SIMULACION, nombreContacto: 'Chequeo Automático', canal: 'whatsapp' };
  const respuestasBot = [];
  const problemas = [];

  try {
    await limpiarConversacionSintetica(empresaDemo.id);

    const serviciosReales = await prisma.servicio.findMany({ where: { empresaId: empresaDemo.id, activo: true } });
    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresaDemo.id } });
    if (!recurso) {
      return { ok: true, resumen: `"${empresaDemo.nombre}" no tiene ningún recurso agendable configurado -- chequeo omitido.` };
    }
    const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 1);
    if (dias.length === 0) {
      return { ok: true, resumen: `"${empresaDemo.nombre}" no tiene disponibilidad en los próximos días -- chequeo omitido.` };
    }

    const rSaludo = await procesarMensajeEntrante({ ...paramsBase, textoEntrante: 'Hola, quiero agendar una hora' });
    respuestasBot.push(rSaludo.respuestaTexto);
    if (serviciosReales.length > 1) {
      const ofreceAlgunoReal = serviciosReales.some((s) => (rSaludo.respuestaTexto || '').includes(s.nombre)) || (rSaludo.interactivo?.opciones?.length || 0) > 0;
      if (!ofreceAlgunoReal) problemas.push('el saludo inicial no mostró ningún servicio real configurado (posible menú inventado)');
      const primerServicio = serviciosReales[0];
      const rServicio = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'servicio', valorDecodificado: { servicioId: primerServicio.id, servicioNombre: primerServicio.nombre } });
      respuestasBot.push(rServicio.respuestaTexto);
    }

    const fecha = dias[0].fecha;
    await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'dia', valorDecodificado: { fecha } });
    const convTrasDia = await prisma.conversacion.findFirst({ where: { empresaId: empresaDemo.id, telefono: TELEFONO_SIMULACION } });
    const hora = (convTrasDia?.reservaEnCurso?.opcionesMostradas || [])[0]?.valor;
    if (!hora) {
      problemas.push('no se ofreció ningún horario disponible tras elegir el día');
    } else {
      const rHora = await procesarSeleccionInteractiva({ ...paramsBase, tipoSeleccion: 'hora', valorDecodificado: { fecha, hora } });
      respuestasBot.push(rHora.respuestaTexto);

      const rNombre = await procesarMensajeEntrante({ ...paramsBase, textoEntrante: 'Cliente de Prueba Automática' });
      respuestasBot.push(rNombre.respuestaTexto);

      let rFinal = rNombre;
      if (empresaDemo.requiereRut) {
        rFinal = await procesarMensajeEntrante({ ...paramsBase, textoEntrante: 'mi rut es 11111111-1 y mi teléfono es 911111111' });
        respuestasBot.push(rFinal.respuestaTexto);
      }

      if (!/agendada exitosamente/i.test(rFinal.respuestaTexto || '')) {
        problemas.push(`el flujo completo de agendamiento no terminó en éxito -- última respuesta: "${(rFinal.respuestaTexto || '').slice(0, 200)}"`);
      }
    }

    const respuestaConVoseo = respuestasBot.find((texto) => REGEX_VOSEO.test(texto || ''));
    if (respuestaConVoseo) {
      problemas.push(`el bot voseó en una respuesta: "${respuestaConVoseo.slice(0, 200)}"`);
    }
  } catch (error) {
    problemas.push(`la simulación lanzó una excepción: ${error.message}`);
  } finally {
    await limpiarConversacionSintetica(empresaDemo.id).catch((error) => {
      console.error(`[CHEQUEO-SALUD-DIARIO] No se pudo limpiar la conversación sintética (teléfono ${TELEFONO_SIMULACION}) -- revisar manualmente:`, error.message);
    });
  }

  if (problemas.length === 0) {
    return { ok: true, resumen: `Conversación sintética contra "${empresaDemo.nombre}" -- flujo de agendamiento de punta a punta funciona bien.` };
  }
  return { ok: false, resumen: `Falló la simulación contra "${empresaDemo.nombre}": ${problemas.join('; ')}.` };
}

async function ejecutarChequeoSaludDiario() {
  const desde24h = new Date(Date.now() - HORAS_VENTANA_FALLAS * 60 * 60 * 1000);
  const resultados = {
    'A. Fallas de entrega WhatsApp (24h)': await chequeoA_FallasWhatsApp(desde24h),
    'B. Clientes en riesgo (teléfono + cita pendiente)': await chequeoB_TelefonoMalFormadoConCitaFutura(),
    'C. Citas a punto de auto-cancelarse': await chequeoC_CitasAPuntoDeAutoCancelar(),
    'D. Reservas abandonadas activas (informativo)': await chequeoD_ReservasAbandonadasActivas(),
    'E. Respuestas del bot con señales de problema (24h)': await chequeoE_RespuestasBotConSenalesDeProblema(desde24h),
    'F. Simulación de conversación sintética (proactivo)': await chequeoF_SimulacionConversacionSintetica(),
  };

  const fallas = Object.entries(resultados).filter(([, r]) => !r.ok);

  console.log('\n[CHEQUEO-SALUD-DIARIO] ' + new Date().toISOString());
  for (const [nombre, r] of Object.entries(resultados)) {
    console.log(`  ${r.ok ? '✅' : '⚠️ '} ${nombre}: ${r.resumen}`);
  }

  // Se manda TODOS los días, haya o no problemas (pedido explícito
  // 2026-09-23) -- además de avisar de fallas, sirve como "latido": si el
  // mensaje no llega un día, es señal de que el job mismo dejó de correr,
  // no solo de que todo esté bien.
  const estado = fallas.length === 0
    ? 'Todo OK -- los 6 chequeos pasaron ✅'
    : `${fallas.length} punto(s) a revisar ⚠️`;

  console.log(fallas.length === 0
    ? '[CHEQUEO-SALUD-DIARIO] Todo OK, se manda el aviso diario igual.'
    : `[CHEQUEO-SALUD-DIARIO] ${fallas.length} problema(s), se manda el aviso.`);

  const telefonoAlerta = process.env.ALERTA_SALUD_TELEFONO;
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  if (!telefonoAlerta || !phoneNumberId || !accessToken) {
    console.warn('[CHEQUEO-SALUD-DIARIO] Falta ALERTA_SALUD_TELEFONO/DEMO_PHONE_NUMBER_ID/DEMO_WHATSAPP_ACCESS_TOKEN -- no se pudo avisar por WhatsApp, revisar logs.');
    return;
  }

  try {
    await sendWhatsAppTemplateMessage({
      phoneNumberId,
      to: telefonoAlerta,
      templateName: PLANTILLA_ALERTA,
      variables: [estado],
      accessToken,
    });
    console.log(`[CHEQUEO-SALUD-DIARIO] Aviso diario enviado a ${telefonoAlerta} (${estado}).`);
  } catch (error) {
    console.error('[CHEQUEO-SALUD-DIARIO] Error enviando el aviso por WhatsApp:', error.message);
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
