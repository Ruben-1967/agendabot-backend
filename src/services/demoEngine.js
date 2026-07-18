// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta, y en el paso de simulación SÍ delega a los motores reales para que
// la experiencia se sienta auténtica.
//
// IMPORTANTE: el estado propio de la demo (en qué paso va, historial de la
// simulación) se guarda en el modelo DemoAsignada, NO en Conversacion. El
// motor real de chatbot (chatbotEngine.js / claude.js) usa Conversacion.mensajes
// con su propia forma de datos — si el motor de demo escribiera ahí también,
// ambos se pisarían entre sí.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { procesarMensajeEntrante } = require('./chatbotEngine');
const { procesarMensajeCatalogoRotativo } = require('./pedidosEngine');
const { decodificarFilaHorario } = require('./whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar'; // AJUSTAR cuando exista el link real

const PASOS = {
  INICIO: 0,
  SIMULACION_LIBRE: 1,
  ESPERANDO_PRODUCTOS: 2,
  PREGUNTAS_ABIERTAS: 3,
};

// (Ya no hay un mínimo de turnos fijo: la simulación libre dura hasta que
// el negocio pregunta por precio/planes/contratar — ver PASOS.SIMULACION_LIBRE.)

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return `💳 Créditos prepagados: $149 CLP por mensaje enviado, mínimo 50 por compra. Pagas solo lo que usas.`;
  }
  return `💰 Planes desde $9.900 hasta $49.900 CLP/mes según volumen de citas, + 1 UF de hosting al año.`;
}

/**
 * Responde preguntas abiertas después del cierre (objeciones, dudas de precio,
 * condiciones, etc.) usando Claude. Instrucción clave: nunca inventar
 * compromisos contractuales que Ruben no ha confirmado — ante eso, ser
 * honesto y ofrecer conectar con el equipo real.
 */
async function responderPreguntaAbierta({ pregunta, empresaDemo, modoOperacion }) {
  const systemPrompt = `Eres el mismo asistente de venta de Totemsystem que ya estuvo mostrando una demo.
Ahora el prospecto está haciendo preguntas de cierre (precio, condiciones, dudas). Responde en 2-4 líneas,
tono directo y cercano, como WhatsApp — nunca un párrafo largo.

Datos reales que puedes usar:
- Modo agendamiento: planes desde $9.900 hasta $49.900 CLP/mes según volumen de citas, + 1 UF de hosting anual.
- Modo catálogo rotativo: créditos prepagados a $149 CLP por mensaje, mínimo 50 créditos por compra.
- El producto responde WhatsApp 24/7, agenda o toma pedidos automáticamente, y se personaliza al rubro del negocio.

Regla estricta: NUNCA inventes políticas de cancelación, reembolso, garantías, plazos de prueba, ni
condiciones contractuales que no aparezcan arriba. Si preguntan algo así (ej. "qué pasa si no me sirve",
"puedo cancelar cuando quiera"), sé honesto: di que esas condiciones las confirma el equipo comercial
directamente, y ofrece seguir la conversación con ellos. No prometas nada que no esté en los datos de arriba.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemPrompt,
    messages: [{ role: 'user', content: pregunta }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Buena pregunta — te conecto con el equipo para que te lo confirmen bien.';
}

/**
 * Punto de entrada del motor de demo. Se llama en vez de procesarMensajeEntrante /
 * procesarMensajeCatalogoRotativo cuando el mensaje llega al número de pruebas.
 */
async function procesarMensajeDemo({ demoAsignada, telefonoCliente, mensaje, nombreContacto }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;
  const paso = demoAsignada.paso || PASOS.INICIO;
  const historial = Array.isArray(demoAsignada.historialSimulacion) ? demoAsignada.historialSimulacion : [];

  // Si el prospecto tocó una hora de la lista interactiva que le mostramos
  // (ver más abajo, PASOS.SIMULACION_LIBRE), el id de la fila trae la fecha
  // codificada — lo traducimos al mismo texto de confirmación que usa el
  // flujo real, para que Claude tenga fecha+hora exactas y no solo el título
  // visible ("10:00", sin fecha).
  const horarioElegido = mensaje.type === 'interactive'
    ? decodificarFilaHorario(mensaje.interactive?.list_reply?.id)
    : null;

  const textoEntrante = horarioElegido
    ? `Confirmo que quiero agendar para el ${horarioElegido.fecha} a las ${horarioElegido.hora}.`
    : mensaje.type === 'button'
      ? (mensaje.button?.text || '')
      : (mensaje.type === 'interactive'
        ? (mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '')
        : (mensaje.text?.body || ''));

  let respuestaTexto;
  let interactivo = null;
  let nuevoPaso = paso;
  let nuevoHistorial = historial;

  switch (paso) {
    // ------------------------------------------------------------
    // PASO 0: identidad + gancho, corto y directo al dolor real.
    // ------------------------------------------------------------
    case PASOS.INICIO: {
      respuestaTexto =
        `¡Hola${nombreContacto ? ` ${nombreContacto}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
        `Te voy a responder como si fuera *"${empresaDemo.nombre}"* — solo para esta prueba, no uso tu marca para nada más.\n\n` +
        `¿Cuántos clientes se te escapan por no alcanzar a responder a tiempo? Pruébalo tú mismo — ` +
        `escríbeme algo, como si fueras un cliente tuyo 👇`;
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      break;
    }

    // ------------------------------------------------------------
    // PASO 1: delega al motor real para que el prospecto pruebe el
    // agendamiento de verdad. Sigue así indefinidamente — solo salta a
    // personalización/precios cuando el negocio lo pide explícitamente
    // (no por cantidad de turnos, para no sentirse apurado).
    // ------------------------------------------------------------
    case PASOS.SIMULACION_LIBRE: {
      // Si el prospecto pregunta por precio, planes, costo o contratar,
      // saltamos directo a pedirle sus productos para cotizar — sin gastar
      // una llamada al motor de agendamiento con una pregunta que no le
      // corresponde responder a él.
      const pareceQuererPrecio = /precio|beneficios?|cuesta|cu[aá]nto (sale|vale|cobra|es)|tarifa|\bcosto\b|plan(es)?\b|contrat(ar|o)|comprar|cotiza/i.test(textoEntrante);

      if (pareceQuererPrecio) {
        respuestaTexto = `¡Con gusto! Para darte un ejemplo con tu negocio real: dime 2 o 3 productos o servicios que ofreces, separados por coma.`;
        nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
        nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
        break;
      }

      let respuestaMotorReal = null;
      let interactivoMotorReal = null;

      try {
        if (modoOperacion === 'CATALOGO_ROTATIVO') {
          const resultado = await procesarMensajeCatalogoRotativo({
            empresa: empresaDemo, telefonoCliente, mensaje, nombreContacto,
          });
          respuestaMotorReal = resultado?.respuestaTexto || null;
        } else {
          const resultado = await procesarMensajeEntrante({
            empresa: empresaDemo, telefonoCliente, textoEntrante, nombreContacto,
          });
          respuestaMotorReal = resultado?.respuestaTexto || null;
          interactivoMotorReal = resultado?.interactivo || null;
        }
      } catch (error) {
        console.error('[DEMO] Error delegando al motor real, se usa fallback:', error.message);
        respuestaMotorReal = null;
      }

      nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

      // Detecta si Claude está pidiendo confirmar antes de agendar (ej. tras
      // elegir una hora). Es una detección por texto — no perfecta, pero
      // cubre el patrón real que usa el system prompt de claude.js.
      const pareceEsperandoConfirmacion = /¿confirmas|\(sí\/no\)|¿confirmo/i.test(respuestaMotorReal || '');

      respuestaTexto = pareceEsperandoConfirmacion
        ? `${respuestaMotorReal}\n\n_(en tu negocio real, el nombre y teléfono del cliente se registran automáticamente desde WhatsApp — no hace falta pedirlos aparte)_`
        : (respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?');
      interactivo = interactivoMotorReal;
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      break;
    }

    // ------------------------------------------------------------
    // PASO 2: personalización + cierre corto.
    // ------------------------------------------------------------
    case PASOS.ESPERANDO_PRODUCTOS: {
      const itemsIngresados = textoEntrante
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);

      const listaFormateada = itemsIngresados.length > 0
        ? itemsIngresados.map((item) => `• ${item}`).join('\n')
        : '• (así se vería con tus productos reales)';

      const ejemploPersonalizado = modoOperacion === 'CATALOGO_ROTATIVO'
        ? `🛍️ *${empresaDemo.nombre}*\n\n${listaFormateada}`
        : `📅 *${empresaDemo.nombre}*\n\n${listaFormateada}`;

      respuestaTexto =
        `Así se vería con tu negocio 👇\n\n${ejemploPersonalizado}\n\n` +
        `Los negocios no suelen perder clientes por mal servicio — los pierden por no estar ahí ` +
        `justo cuando alguien los necesitaba.\n\n` +
        `${textoPrecios(modoOperacion)}\n\n` +
        `Detalle completo: ${LINK_LANDING}\n¿Seguimos? 👉 ${LINK_CONTRATACION}\n\n` +
        `_(¿tienes dudas de precio o condiciones? Pregúntame, sigo aquí)_`;

      nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
      break;
    }

    // ------------------------------------------------------------
    // PASO 3: preguntas abiertas post-cierre, respondidas por Claude
    // en vez de un mensaje fijo — sin inventar condiciones contractuales.
    // ------------------------------------------------------------
    case PASOS.PREGUNTAS_ABIERTAS:
    default: {
      try {
        respuestaTexto = await responderPreguntaAbierta({
          pregunta: textoEntrante,
          empresaDemo,
          modoOperacion,
        });
      } catch (error) {
        console.error('[DEMO] Error respondiendo pregunta abierta:', error.message);
        respuestaTexto = `Buena pregunta — te conecto con el equipo para confirmártelo bien. Mientras, puedes ver más acá: ${LINK_LANDING}`;
      }
      // nuevoPaso se queda en PREGUNTAS_ABIERTAS — se puede seguir preguntando indefinidamente
      break;
    }
  }

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { paso: nuevoPaso, historialSimulacion: nuevoHistorial },
  });

  return { respuestaTexto, interactivo };
}

module.exports = { procesarMensajeDemo };