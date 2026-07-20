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
// NO en Conversacion.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { procesarMensajeCatalogoDemo } = require('./catalogoDemoEngine');
const { decodificarFilaHorario } = require('./whatsapp');
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
  AGENDA_ESPERANDO_DATOS: 5, // NUEVO — esperando nombre+edad tras elegir hora simulada
};

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return `💳 Créditos prepagados: $149 CLP por mensaje enviado, mínimo 50 por compra. Pagas solo lo que usas.`;
  }
  return `💰 Planes desde $9.900 hasta $49.900 CLP/mes según volumen de citas, + 1 UF de hosting al año.`;
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

async function responderPreguntaAbierta({ pregunta, empresaDemo, modoOperacion }) {
  const systemPrompt = `Eres el mismo asistente de venta de Totemsystem que ya estuvo mostrando una demo.
Ahora el prospecto está haciendo preguntas de cierre (precio, condiciones, dudas). Responde en 2-4 líneas,
tono directo y cercano, como WhatsApp — nunca un párrafo largo.

Datos reales que puedes usar:
- Modo agendamiento: planes desde $9.900 hasta $49.900 CLP/mes según volumen de citas, + 1 UF de hosting anual.
- Modo catálogo rotativo: créditos prepagados a $149 CLP por mensaje, mínimo 50 créditos por compra.
- El producto responde WhatsApp 24/7, agenda o toma pedidos automáticamente, y se personaliza al rubro del negocio.

Regla estricta: NUNCA inventes políticas de cancelación, reembolso, garantías, plazos de prueba, ni
condiciones contractuales que no aparezcan arriba. Si preguntan algo así, sé honesto: di que esas
condiciones las confirma el equipo comercial directamente. No prometas nada que no esté en los datos de arriba.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemPrompt,
    messages: [{ role: 'user', content: pregunta }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Buena pregunta — te conecto con el equipo para que te lo confirmen bien.';
}

// NUEVO: responde preguntas libres del prospecto durante la simulación de
// agendamiento (ej. "¿qué servicios ofrecen?", "¿dónde están ubicados?"),
// usando solo los datos reales cargados de la empresa de demo — sin tools,
// sin depender del motor real de agendamiento.
async function responderPreguntaSobreNegocio({ pregunta, empresaDemo, serviciosBase }) {
  const systemPrompt = `Eres el asistente de WhatsApp de "${empresaDemo.nombre}" (esto es una demo comercial de Totemsystem).
Servicios que ofrece: ${serviciosBase.length ? serviciosBase.join(', ') : 'servicios generales del rubro'}.
${empresaDemo.direccion ? `Dirección: ${empresaDemo.direccion}.` : ''}
${empresaDemo.informacionAdicional ? `Información adicional que puedes citar tal cual: ${empresaDemo.informacionAdicional}` : ''}

Responde en 1-3 líneas, tono cordial y directo, como WhatsApp. Si preguntan por agendar, invítalos a decir
el servicio que quieren para mostrarles los horarios disponibles. NUNCA inventes precios, horarios exactos,
ni políticas que no te dieron arriba — si no lo sabes, dilo con naturalidad.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: pregunta }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NUEVO: detecta si el prospecto quiere agendar — por el nombre de un
// servicio real del rubro, o por palabras genéricas de agendamiento.
function detectaIntencionAgendar(texto, serviciosBase) {
  const patronGenerico = /agendar|reservar|\bhora\b|\bcita\b|\bturno\b/i;
  if (patronGenerico.test(texto)) return true;
  if (serviciosBase.length === 0) return false;
  const patronServicios = new RegExp(serviciosBase.map(escaparRegex).join('|'), 'i');
  return patronServicios.test(texto);
}

async function procesarMensajeDemo({ demoAsignada, telefonoCliente, mensaje, nombreContacto }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;
  const paso = demoAsignada.paso || PASOS.INICIO;
  const historial = Array.isArray(demoAsignada.historialSimulacion) ? demoAsignada.historialSimulacion : [];
  const carritoActual = Array.isArray(demoAsignada.carritoDemoJson) ? demoAsignada.carritoDemoJson : [];

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

  const idFilaElegida = mensaje.type === 'interactive'
    ? mensaje.interactive?.list_reply?.id
    : null;

  let respuestaTexto;
  let interactivo = null;
  let nuevoPaso = paso;
  let nuevoHistorial = historial;
  let nuevoCitaDemo = demoAsignada.citaDemoJson || null;

  // ------------------------------------------------------------
  // Si el prospecto tocó una hora simulada (modo agendamiento), no pasa por
  // el switch normal — pedimos nombre+edad y guardamos la fecha/hora elegida.
  // ------------------------------------------------------------
  if (horarioElegido && modoOperacion === 'AGENDAMIENTO') {
    nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
    nuevoCitaDemo = { ...(nuevoCitaDemo || {}), fecha: horarioElegido.fecha, hora: horarioElegido.hora };
    const fechaLegible = fechaLegibleDesdeISO(horarioElegido.fecha);

    respuestaTexto =
      `Perfecto, ${fechaLegible} a las ${horarioElegido.hora}. Para dejarlo agendado, dime el *nombre completo* ` +
      `y la *edad* de la persona, separados por coma (ej. "Juan Pérez, 34").\n\n` +
      `_(Esto es solo para la demo — en el negocio real, el nombre y teléfono del cliente se capturan automático ` +
      `desde WhatsApp, sin pedirlos aparte. Solo se piden datos extra como este cuando el rubro los necesita.)_`;
    nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
  } else {
    switch (paso) {
      // ------------------------------------------------------------
      // PASO 0: identidad + gancho.
      // ------------------------------------------------------------
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

      // ------------------------------------------------------------
      // PASO 1: simulación libre. Detecta intención de precio (de
      // Totemsystem) o de agendar (modo AGENDAMIENTO); si no es ninguna
      // de las dos, responde libremente sobre el negocio simulado o
      // delega al carrito real (modo CATALOGO_ROTATIVO).
      // ------------------------------------------------------------
      case PASOS.SIMULACION_LIBRE: {
        const hablaDePagoDelNegocio = /medios?\s+de\s+pago|formas?\s+de\s+pago|plan(es)?\s+de\s+pago/i.test(textoEntrante);
        const pareceQuererPrecio = !hablaDePagoDelNegocio &&
          /precio|beneficios?|cu[aá]nto (sale|vale|cobra|cuesta|es)|tarifa|\bcosto\b|\bplan(es)?\b|contrat(ar|o)|cotiza|totemsystem/i.test(textoEntrante);

        if (pareceQuererPrecio) {
          nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
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

        nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

        if (modoOperacion === 'AGENDAMIENTO') {
          const serviciosBase = Array.isArray(empresaDemo.rubroTemplate.serviciosBase)
            ? empresaDemo.rubroTemplate.serviciosBase
            : [];

          if (detectaIntencionAgendar(textoEntrante, serviciosBase)) {
            nuevoCitaDemo = { servicio: textoEntrante.trim() };
            respuestaTexto = '¡Claro! Estos son los próximos días disponibles:';
            interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }

          try {
            respuestaTexto = await responderPreguntaSobreNegocio({ pregunta: textoEntrante, empresaDemo, serviciosBase });
          } catch (error) {
            console.error('[DEMO] Error respondiendo pregunta libre de agendamiento:', error.message);
            respuestaTexto = '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
          }
          nuevoPaso = PASOS.SIMULACION_LIBRE;
          break;
        }

        // CATALOGO_ROTATIVO: delega al motor simplificado con carrito real.
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

      // ------------------------------------------------------------
      // NUEVO PASO: esperando nombre+edad tras elegir hora simulada.
      // ------------------------------------------------------------
      case PASOS.AGENDA_ESPERANDO_DATOS: {
        nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

        const partes = textoEntrante.split(',').map((s) => s.trim()).filter(Boolean);
        const nombreProspecto = partes[0] || 'Sin nombre';
        const edadProspecto = partes[1] || 'Sin edad';

        nuevoCitaDemo = { ...(nuevoCitaDemo || {}), nombre: nombreProspecto, edad: edadProspecto };
        const fechaLegible = nuevoCitaDemo.fecha ? fechaLegibleDesdeISO(nuevoCitaDemo.fecha) : 'el día elegido';

        respuestaTexto =
          `📋 *Resumen de tu cita en ${empresaDemo.nombre}*\n\n` +
          `${nuevoCitaDemo.servicio ? `• Servicio: ${nuevoCitaDemo.servicio}\n` : ''}` +
          `• Día: ${fechaLegible}\n` +
          `• Hora: ${nuevoCitaDemo.hora || '-'}\n` +
          `• Nombre: ${nombreProspecto}\n` +
          `• Edad: ${edadProspecto}\n\n` +
          `✅ Listo, quedaste agendado.\n\n` +
          `Y algo que a los negocios les encanta: 24 horas antes te llegaría un recordatorio automático por este ` +
          `mismo WhatsApp. Si no puedes asistir, solo respondes "No" y tu cupo se libera al instante — y se le ` +
          `ofrece automáticamente a la primera persona en lista de espera. Cero llamadas, cero planillas.`;

        nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
        break;
      }

      // ------------------------------------------------------------
      // Desambiguando si "precio" era sobre el negocio simulado o Totemsystem.
      // ------------------------------------------------------------
      case PASOS.DESAMBIGUANDO_PRECIO: {
        nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

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
          const serviciosBase = Array.isArray(empresaDemo.rubroTemplate.serviciosBase)
            ? empresaDemo.rubroTemplate.serviciosBase
            : [];
          try {
            respuestaTexto = await responderPreguntaSobreNegocio({ pregunta: textoEntrante, empresaDemo, serviciosBase });
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

      // ------------------------------------------------------------
      // PASO 2: personalización + cierre corto.
      // ------------------------------------------------------------
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

      // ------------------------------------------------------------
      // PASO 3: preguntas abiertas post-cierre.
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
        break;
      }
    }
  }

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { paso: nuevoPaso, historialSimulacion: nuevoHistorial, citaDemoJson: nuevoCitaDemo },
  });

  return { respuestaTexto, interactivo };
}

module.exports = { procesarMensajeDemo };