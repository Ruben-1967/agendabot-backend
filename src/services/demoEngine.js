// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta. El modo AGENDAMIENTO usa un generador de días/horas SIMULADO (ver
// src/lib/agendaDemoSimulada.js) — nunca depende de que la empresa de demo
// tenga agenda real cargada, y nunca escribe citas reales en la base.
//
// IMPORTANTE: el estado propio de la demo (en qué paso va, historial de la
// simulación, carrito o cita simulada) se guarda en el modelo DemoAsignada,
// NO en Conversacion. El historial registra ambos lados de la conversación,
// el servicio y el nombre/edad se VALIDAN antes de aceptarlos, el mismo
// teléfono puede pedir "reiniciar" la demo, los servicios se muestran como
// lista interactiva, y una intención explícita de CONTRATAR salta directo
// al precio + link, sin pedir productos de ejemplo.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { procesarMensajeCatalogoDemo } = require('./catalogoDemoEngine');
const {
  decodificarFilaHorario,
  decodificarFilaServicioDemo,
  ID_FILA_SERVICIO_OTRO_DEMO,
} = require('./whatsapp');
const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');
const { generarProximosDiasSimulados } = require('../lib/agendaDemoSimulada');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar';

const PASOS = {
  INICIO: 0,
  SIMULACION_LIBRE: 1,
  ESPERANDO_PRODUCTOS: 2,
  PREGUNTAS_ABIERTAS: 3,
  DESAMBIGUANDO_PRECIO: 4,
  AGENDA_ESPERANDO_DATOS: 5,
  AGENDA_ESPERANDO_SERVICIO: 6,
};

const GRILLA_PLANES_TEXTO = `- Plan A: $9.900 CLP/mes — 100 citas incluidas, excedente $150 CLP/cita
- Plan B: $19.900 CLP/mes — 300 citas incluidas, excedente $90 CLP/cita
- Plan C: $49.900 CLP/mes — 700 citas incluidas, excedente $60 CLP/cita
- Todos los planes incluyen, SIN costo adicional: 1 UF de hosting al año, recordatorios automáticos de
  confirmación (24h antes + reintentos) y promoción automática a la lista de espera cuando alguien cancela.
  WhatsApp no cobra por los mensajes de servicio dentro de la ventana de conversación del cliente, así que el
  costo real de operar es mínimo.`;

function detectaIntencionReiniciar(texto, modoOperacion) {
  const pideReinicio = /reiniciar|reinicia|reiniciemos|comenzar de nuevo|empezar de nuevo|volver a empezar|volvamos a empezar|desde el inicio|desde cero|de nuevo|nuevamente|otra vez|iniciar (la )?demo/i.test(texto);
  const mencionaEquipo = /mostrar(le|la|selo|sela)?\s+a\s+(mi|su|otro)\s+(equipo|jefe|socio|colega)/i.test(texto);

  if (mencionaEquipo) return true;
  if (!pideReinicio) return false;

  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return /\bdemo\b/i.test(texto);
  }
  return true;
}

// Señal de compra mucho más fuerte que "cuánto cuesta" — cuando el
// prospecto ya quiere contratar directamente, hay que ir al precio + link
// de una vez, sin pedirle ejemplos de productos como si quisiera
// personalizar la demo primero (eso es fricción innecesaria cuando la
// intención de compra ya es explícita).
function detectaIntencionContratarDirecta(texto) {
  return /c[oó]mo (lo )?contrato|quiero contratar|inscribirme|comenzar (ya|ahora)|firmar( el)? contrato|d[oó]nde contrato/i.test(texto);
}

function historialAMensajes(historial) {
  const recortado = historial.slice(-40);
  const mensajes = [];
  for (const turno of recortado) {
    const role = turno.rol === 'asistente' ? 'assistant' : 'user';
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo && ultimo.role === role) {
      ultimo.content += `\n${turno.texto}`;
    } else {
      mensajes.push({ role, content: turno.texto });
    }
  }
  while (mensajes.length && mensajes[0].role !== 'user') {
    mensajes.shift();
  }
  return mensajes;
}

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return `💳 Créditos prepagados: $149 CLP por mensaje enviado, mínimo 50 por compra. Pagas solo lo que usas.`;
  }
  return (
    `💰 *Plan A:* $9.900/mes — 100 citas incluidas\n` +
    `💰 *Plan B:* $19.900/mes — 300 citas incluidas\n` +
    `💰 *Plan C:* $49.900/mes — 700 citas incluidas\n` +
    `Los 3 incluyen 1 UF de hosting anual, recordatorios automáticos y lista de espera, sin costo extra.`
  );
}

function construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal }) {
  const listaFormateada = items.length > 0
    ? items.map((item) => `• ${item}`).join('\n')
    : '• (así se vería con tus productos reales)';

  const ejemploPersonalizado = modoOperacion === 'CATALOGO_ROTATIVO'
    ? `🛍️ *${empresaDemo.nombre}*\n\n${listaFormateada}`
    : `📅 *${empresaDemo.nombre}*\n\n${listaFormateada}`;

  const intro = origenCarritoReal
    ? `Justo con lo que ya probaste recién, así se vería con tu negocio 👇`
    : `Así se vería con tu negocio 👇`;

  return (
    `${intro}\n\n${ejemploPersonalizado}\n\n` +
    `Los negocios no suelen perder clientes por mal servicio — los pierden por no estar ahí ` +
    `justo cuando alguien los necesitaba.\n\n` +
    `${textoPrecios(modoOperacion)}\n\n` +
    `Detalle completo: ${LINK_LANDING}\n¿Seguimos? 👉 ${LINK_CONTRATACION}\n\n` +
    `_(¿tienes dudas de precio o condiciones? Pregúntame, sigo aquí)_`
  );
}

async function responderPreguntaAbierta({ historial, modoOperacion }) {
  const systemPrompt = `Eres el mismo asistente de venta de Totemsystem que ya estuvo mostrando una demo.
Ahora el prospecto está haciendo preguntas de cierre (precio, condiciones, dudas). Responde en 2-4 líneas,
tono directo y cercano, como WhatsApp — nunca un párrafo largo. Ya tienes todo el historial de la
conversación arriba — úsalo para no perder el hilo (ej. si preguntó cuántas citas hace y luego solo
responde un número, entiende que es la respuesta a esa pregunta).

Grilla EXACTA de planes de agendamiento — usa estos números tal cual, NUNCA inventes ni redondees otros:
${GRILLA_PLANES_TEXTO}

Modo catálogo rotativo: créditos prepagados a $149 CLP por mensaje, mínimo 50 créditos por compra.
El producto responde WhatsApp 24/7, agenda o toma pedidos automáticamente, y se personaliza al rubro del negocio.

Regla estricta: NUNCA inventes políticas de cancelación, reembolso, garantías, plazos de prueba, ni
condiciones contractuales que no aparezcan arriba. Si preguntan algo así, sé honesto: di que esas
condiciones las confirma el equipo comercial directamente. No prometas nada que no esté en los datos de arriba.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemPrompt,
    messages: historialAMensajes(historial),
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Buena pregunta — te conecto con el equipo para que te lo confirmen bien.';
}

async function responderPreguntaSobreNegocio({ historial, empresaDemo, serviciosBase }) {
  const systemPrompt = `Eres el asistente de WhatsApp de "${empresaDemo.nombre}" (esto es una demo comercial de Totemsystem).
Servicios que ofrece: ${serviciosBase.length ? serviciosBase.join(', ') : 'servicios generales del rubro'}.
${empresaDemo.direccion ? `Dirección: ${empresaDemo.direccion}.` : ''}
${empresaDemo.informacionAdicional ? `Información adicional que puedes citar tal cual: ${empresaDemo.informacionAdicional}` : ''}

Ya tienes arriba el historial completo de la conversación — úsalo para no perder el hilo. Responde en 1-3
líneas, tono cordial y directo, como WhatsApp. Si preguntan por agendar, invítalos a decir el servicio que
quieren para mostrarles los horarios disponibles. NUNCA inventes precios, horarios exactos, ni políticas que
no te dieron arriba — si no lo sabes, dilo con naturalidad.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: historialAMensajes(historial),
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PALABRAS_VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'del', 'al']);

function normalizarTexto(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function palabrasSignificativas(s) {
  return normalizarTexto(s).split(/\s+/).filter((p) => p && !PALABRAS_VACIAS.has(p));
}

function detectarServicioMencionado(texto, serviciosBase) {
  const textoNorm = normalizarTexto(texto);

  // Paso 1: coincidencia completa — todas las palabras significativas del
  // servicio están presentes (más preciso, ej. "examen de vista" con el
  // servicio real "Examen de la vista").
  for (const servicio of serviciosBase) {
    const palabras = palabrasSignificativas(servicio);
    if (palabras.length > 0 && palabras.every((p) => textoNorm.includes(p))) {
      return servicio;
    }
  }

  // Paso 2: coincidencia parcial — el cliente puede usar solo UNA palabra
  // clave (ej. "examen" en vez del nombre completo). Buscamos servicios que
  // contengan esa palabra como palabra completa. Si hay ambigüedad (dos
  // servicios comparten la palabra), no elegimos por él — mejor volver a
  // preguntar que agendar el servicio equivocado.
  const candidatos = serviciosBase.filter((servicio) => {
    const palabras = palabrasSignificativas(servicio);
    return palabras.some((p) => new RegExp(`\\b${escaparRegex(p)}\\b`, 'i').test(textoNorm));
  });

  return candidatos.length === 1 ? candidatos[0] : null;
}

function detectaIntencionAgendarGenerico(texto) {
  return /agendar|reservar|\bhoras?\b|\bhorarios?\b|\bcita\b|\bturno\b/i.test(texto);
}

// Arma el interactivo de servicios como lista tocable, con "Otro/no lo
// encuentro" al final — mismo patrón que el chatbot real.
function interactivoListaServiciosDemo(serviciosBase) {
  return { tipo: 'lista_servicios_demo', servicios: serviciosBase };
}

async function procesarMensajeDemo({ demoAsignada, telefonoCliente, mensaje, nombreContacto }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;
  const paso = demoAsignada.paso || PASOS.INICIO;
  const historial = Array.isArray(demoAsignada.historialSimulacion) ? demoAsignada.historialSimulacion : [];
  const carritoActual = Array.isArray(demoAsignada.carritoDemoJson) ? demoAsignada.carritoDemoJson : [];
  const serviciosBase = Array.isArray(empresaDemo.rubroTemplate.serviciosBase)
    ? empresaDemo.rubroTemplate.serviciosBase
    : [];

  const horarioElegido = mensaje.type === 'interactive'
    ? decodificarFilaHorario(mensaje.interactive?.list_reply?.id)
    : null;

  const idFilaElegida = mensaje.type === 'interactive'
    ? mensaje.interactive?.list_reply?.id
    : null;

  const textoEntrante = horarioElegido
    ? `Confirmo que quiero agendar para el ${horarioElegido.fecha} a las ${horarioElegido.hora}.`
    : mensaje.type === 'button'
      ? (mensaje.button?.text || '')
      : (mensaje.type === 'interactive'
        ? (mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '')
        : (mensaje.text?.body || ''));

  // Reinicio manual de la demo, sin importar en qué paso esté hoy. Solo
  // aplica a texto libre (no tiene sentido si viene de una selección de
  // lista/botón).
  if (mensaje.type === 'text' && detectaIntencionReiniciar(textoEntrante, modoOperacion)) {
    const nombreParaSaludo = demoAsignada.nombreProspecto || nombreContacto;
    const respuestaTexto =
      `¡Dale! 🔄 Reiniciamos la demo desde cero.\n\n` +
      `¡Hola${nombreParaSaludo ? ` ${nombreParaSaludo}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
      `Te voy a responder como si fuera *"${empresaDemo.nombre}"* — solo para esta prueba, no uso tu marca para nada más.\n\n` +
      `Pruébalo tú mismo — escríbeme algo, como si fueras un cliente tuyo 👇`;

    await prisma.demoAsignada.update({
      where: { id: demoAsignada.id },
      data: {
        paso: PASOS.SIMULACION_LIBRE,
        historialSimulacion: [{ rol: 'asistente', texto: respuestaTexto }],
        citaDemoJson: null,
        carritoDemoJson: [],
      },
    });

    return { respuestaTexto, interactivo: null };
  }

  let nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

  let respuestaTexto;
  let interactivo = null;
  let nuevoPaso = paso;
  let nuevoCitaDemo = demoAsignada.citaDemoJson || null;
  let yaResuelto = false;

  // Selección de un SERVICIO real de la lista tocable (o "Otro/no lo
  // encuentro"), en modo AGENDAMIENTO. Se resuelve ANTES del switch de
  // pasos, igual que la hora — puede llegar desde más de un paso distinto.
  if (mensaje.type === 'interactive' && modoOperacion === 'AGENDAMIENTO') {
    if (idFilaElegida === ID_FILA_SERVICIO_OTRO_DEMO) {
      try {
        respuestaTexto = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
      } catch (error) {
        console.error('[DEMO] Error respondiendo tras "otro/no lo encuentro":', error.message);
        respuestaTexto = '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
      }
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      yaResuelto = true;
    } else {
      const indiceServicio = decodificarFilaServicioDemo(idFilaElegida);
      if (indiceServicio != null && serviciosBase[indiceServicio]) {
        nuevoCitaDemo = { servicio: serviciosBase[indiceServicio] };
        respuestaTexto = '¡Perfecto! Estos son los próximos días disponibles:';
        interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        yaResuelto = true;
      }
    }
  }

if (!yaResuelto && horarioElegido && modoOperacion === 'AGENDAMIENTO') {
    nuevoCitaDemo = { ...(nuevoCitaDemo || {}), fecha: horarioElegido.fecha, hora: horarioElegido.hora };
    const fechaLegible = fechaLegibleDesdeISO(horarioElegido.fecha);

    respuestaTexto = `Perfecto, ${fechaLegible} a las ${horarioElegido.hora}. Para dejarlo agendado, dime tu *nombre completo*.`;
    nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
    yaResuelto = true;
  }

  if (!yaResuelto) {
    switch (paso) {
      case PASOS.INICIO: {
        const nombreParaSaludo = demoAsignada.nombreProspecto || nombreContacto;
        respuestaTexto =
          `¡Hola${nombreParaSaludo ? ` ${nombreParaSaludo}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
          `Te voy a responder como si fuera *"${empresaDemo.nombre}"* — solo para esta prueba, no uso tu marca para nada más.\n\n` +
          `Pruébalo tú mismo — ` +
          `escríbeme algo, como si fueras un cliente tuyo 👇`;
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.SIMULACION_LIBRE: {
        // Intención de contratar ya explícita — va directo al precio + link,
        // sin pedir productos de ejemplo (esa personalización solo tiene
        // sentido cuando el prospecto está evaluando, no cuando ya decidió).
        if (detectaIntencionContratarDirecta(textoEntrante)) {
          const items = carritoActual.length > 0 ? carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`) : [];
          respuestaTexto = construirMockupYPitch({
            items, empresaDemo, modoOperacion, origenCarritoReal: carritoActual.length > 0,
          });
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        const hablaDePagoDelNegocio = /medios?\s+de\s+pago|formas?\s+de\s+pago|plan(es)?\s+de\s+pago/i.test(textoEntrante);
        const pareceQuererPrecio = !hablaDePagoDelNegocio &&
          /precio|beneficios?|cu[aá]nto (sale|vale|cobra|cuesta|es)|tarifa|\bcosto\b|\bplan(es)?\b|contrat(ar|o)|cotiza|totemsystem/i.test(textoEntrante);

        if (pareceQuererPrecio) {
          const esInequivoco = /totemsystem/i.test(textoEntrante);

          if (esInequivoco) {
            if (modoOperacion === 'CATALOGO_ROTATIVO' && carritoActual.length > 0) {
              const items = carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`);
              respuestaTexto = construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal: true });
              nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
            } else {
              respuestaTexto = `¡Con gusto! Para darte un ejemplo con tu negocio real: dime 2 o 3 productos o servicios que ofreces, separados por coma.`;
              nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
            }
            break;
          }

          respuestaTexto = '¿Tu pregunta es sobre...? 👇';
          interactivo = {
            tipo: 'lista_desambiguacion_precio',
            opciones: [
              {
                id: 'precio_producto',
                titulo: modoOperacion === 'CATALOGO_ROTATIVO' ? 'Precio de un producto' : 'Precio de un servicio',
                descripcion: 'Sigo probando el negocio',
              },
              {
                id: 'precio_totemsystem',
                titulo: 'Precio de Totemsystem',
                descripcion: 'El servicio de esta demo',
              },
            ],
          };
          nuevoPaso = PASOS.DESAMBIGUANDO_PRECIO;
          break;
        }

        if (modoOperacion === 'AGENDAMIENTO') {
          const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

          if (servicioMencionado) {
            nuevoCitaDemo = { servicio: servicioMencionado };
            respuestaTexto = '¡Claro! Estos son los próximos días disponibles:';
            interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }

          if (detectaIntencionAgendarGenerico(textoEntrante) && serviciosBase.length > 0) {
            respuestaTexto = '¡Claro! ¿Para cuál de estos servicios? 👇';
            interactivo = interactivoListaServiciosDemo(serviciosBase);
            nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
            break;
          }

          try {
            respuestaTexto = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
          } catch (error) {
            console.error('[DEMO] Error respondiendo pregunta libre de agendamiento:', error.message);
            respuestaTexto = '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
          }
          nuevoPaso = PASOS.SIMULACION_LIBRE;
          break;
        }

        let respuestaMotorReal = null;
        let interactivoMotorReal = null;
        try {
          const resultado = await procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje });
          respuestaMotorReal = resultado?.respuestaTexto || null;
          interactivoMotorReal = resultado?.interactivo || null;
        } catch (error) {
          console.error('[DEMO] Error delegando al motor de catálogo, se usa fallback:', error.message);
        }
        respuestaTexto = respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?';
        interactivo = interactivoMotorReal;
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.AGENDA_ESPERANDO_SERVICIO: {
        const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

        if (!servicioMencionado) {
          respuestaTexto = 'No alcancé a reconocer ese servicio — elige uno de estos 👇';
          interactivo = interactivoListaServiciosDemo(serviciosBase);
          nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
          break;
        }

        nuevoCitaDemo = { servicio: servicioMencionado };
        respuestaTexto = '¡Perfecto! Estos son los próximos días disponibles:';
        interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.AGENDA_ESPERANDO_DATOS: {
        const partes = textoEntrante.split(',').map((s) => s.trim()).filter(Boolean);
        const edadCandidata = partes[partes.length - 1];
        const pareceValido = partes.length >= 2 && /^\d{1,3}$/.test(edadCandidata);

      case PASOS.AGENDA_ESPERANDO_DATOS: {
        const nombreProspecto = textoEntrante.trim();

        if (nombreProspecto.length < 2) {
          respuestaTexto = 'No alcancé a leer bien tu nombre — ¿me lo repites?';
          nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
          break;
        }

        nuevoCitaDemo = { ...(nuevoCitaDemo || {}), nombre: nombreProspecto };
        const fechaLegible = nuevoCitaDemo.fecha ? fechaLegibleDesdeISO(nuevoCitaDemo.fecha) : 'el día elegido';

        respuestaTexto =
          `📋 *Resumen de tu cita en ${empresaDemo.nombre}*\n\n` +
          `${nuevoCitaDemo.servicio ? `• Servicio: ${nuevoCitaDemo.servicio}\n` : ''}` +
          `• Día: ${fechaLegible}\n` +
          `• Hora: ${nuevoCitaDemo.hora || '-'}\n` +
          `• Nombre: ${nombreProspecto}\n\n` +
          `✅ Listo, quedaste agendado.\n\n` +
          `Y algo que a los negocios les encanta: 24 horas antes te llegaría un recordatorio automático por este ` +
          `mismo WhatsApp. Si no puedes asistir, solo respondes "No" y tu cupo se libera al instante — y se le ` +
          `ofrece automáticamente a la primera persona en lista de espera. Cero llamadas, cero planillas.`;

        nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
        break;
      }

      case PASOS.DESAMBIGUANDO_PRECIO: {
        if (idFilaElegida === 'precio_totemsystem') {
          if (modoOperacion === 'CATALOGO_ROTATIVO' && carritoActual.length > 0) {
            const items = carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`);
            respuestaTexto = construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal: true });
            nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          } else {
            respuestaTexto = `¡Con gusto! Para darte un ejemplo con tu negocio real: dime 2 o 3 productos o servicios que ofreces, separados por coma.`;
            nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
          }
          break;
        }

        nuevoPaso = PASOS.SIMULACION_LIBRE;

        if (modoOperacion === 'AGENDAMIENTO') {
          try {
            respuestaTexto = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
          } catch (error) {
            console.error('[DEMO] Error respondiendo tras desambiguación:', error.message);
            respuestaTexto = 'Cuéntame más — ¿qué te gustaría hacer?';
          }
          break;
        }

        try {
          const resultado = await procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje });
          respuestaTexto = resultado?.respuestaTexto || 'Cuéntame más — ¿qué te gustaría hacer?';
          interactivo = resultado?.interactivo || null;
        } catch (error) {
          console.error('[DEMO] Error delegando tras desambiguación, se usa fallback:', error.message);
          respuestaTexto = 'Cuéntame más — ¿qué te gustaría hacer?';
        }
        break;
      }

      case PASOS.ESPERANDO_PRODUCTOS: {
        const itemsIngresados = textoEntrante
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5);

        respuestaTexto = construirMockupYPitch({
          items: itemsIngresados,
          empresaDemo,
          modoOperacion,
          origenCarritoReal: false,
        });

        nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
        break;
      }

      case PASOS.PREGUNTAS_ABIERTAS:
      default: {
        if (detectaIntencionContratarDirecta(textoEntrante)) {
          const items = carritoActual.length > 0 ? carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`) : [];
          respuestaTexto = construirMockupYPitch({
            items, empresaDemo, modoOperacion, origenCarritoReal: carritoActual.length > 0,
          });
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        if (modoOperacion === 'AGENDAMIENTO') {
          const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

          if (servicioMencionado) {
            nuevoCitaDemo = { servicio: servicioMencionado };
            respuestaTexto = '¡Claro! Estos son los próximos días disponibles:';
            interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }

          if (detectaIntencionAgendarGenerico(textoEntrante) && serviciosBase.length > 0) {
            respuestaTexto = '¡Claro! ¿Para cuál de estos servicios? 👇';
            interactivo = interactivoListaServiciosDemo(serviciosBase);
            nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
            break;
          }
        }

        try {
          respuestaTexto = await responderPreguntaAbierta({ historial: nuevoHistorial, modoOperacion });
        } catch (error) {
          console.error('[DEMO] Error respondiendo pregunta abierta:', error.message);
          respuestaTexto = `Buena pregunta — te conecto con el equipo para confirmártelo bien. Mientras, puedes ver más acá: ${LINK_LANDING}`;
        }
        break;
      }
    }
  }

  nuevoHistorial = [...nuevoHistorial, { rol: 'asistente', texto: respuestaTexto }].slice(-40);

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { paso: nuevoPaso, historialSimulacion: nuevoHistorial, citaDemoJson: nuevoCitaDemo },
  });

  return { respuestaTexto, interactivo };
}

module.exports = { procesarMensajeDemo };