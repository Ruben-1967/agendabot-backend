// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta, y en el paso de simulación SÍ delega a los motores reales/simplificados
// para que la experiencia se sienta auténtica.
//
// IMPORTANTE: el estado propio de la demo (en qué paso va, historial de la
// simulación, carrito de la demo de catálogo) se guarda en el modelo
// DemoAsignada, NO en Conversacion.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { procesarMensajeEntrante } = require('./chatbotEngine');
const { procesarMensajeCatalogoDemo } = require('./catalogoDemoEngine');
const { decodificarFilaHorario } = require('./whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar';

const PASOS = {
  INICIO: 0,
  SIMULACION_LIBRE: 1,
  ESPERANDO_PRODUCTOS: 2,
  PREGUNTAS_ABIERTAS: 3,
  DESAMBIGUANDO_PRECIO: 4, // NUEVO — se agrega al final para no correr los valores ya guardados en demos existentes
};

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return `💳 Créditos prepagados: $149 CLP por mensaje enviado, mínimo 50 por compra. Pagas solo lo que usas.`;
  }
  return `💰 Planes desde $9.900 hasta $49.900 CLP/mes según volumen de citas, + 1 UF de hosting al año.`;
}

// NUEVO: arma el mockup de personalización + pitch de precio a partir de una
// lista de items ya formateados (ej. ["Cinnamon roll clásico", "Golfeado"]).
// Se usa tanto cuando el prospecto los escribe a mano (ESPERANDO_PRODUCTOS)
// como cuando ya los eligió de verdad en el carrito real de la demo.
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

  // id crudo de la fila elegida (si el mensaje es una selección de lista) —
  // lo usamos directo para las opciones de desambiguación, que no necesitan
  // un formato codificado especial como horarios/días.
  const idFilaElegida = mensaje.type === 'interactive'
    ? mensaje.interactive?.list_reply?.id
    : null;

  let respuestaTexto;
  let interactivo = null;
  let nuevoPaso = paso;
  let nuevoHistorial = historial;

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
    // PASO 1: delega al motor real (agendamiento) o al motor simplificado
    // de catálogo (demo, con carrito). Solo salta a personalización/precios
    // cuando el negocio pregunta explícitamente por el SERVICIO de
    // Totemsystem — y si es ambiguo (puede ser el precio de un producto del
    // negocio simulado), pregunta antes de asumir.
    // ------------------------------------------------------------
    case PASOS.SIMULACION_LIBRE: {
      const hablaDePagoDelNegocio = /medios?\s+de\s+pago|formas?\s+de\s+pago|plan(es)?\s+de\s+pago/i.test(textoEntrante);
      const pareceQuererPrecio = !hablaDePagoDelNegocio &&
        /precio|beneficios?|cu[aá]nto (sale|vale|cobra|cuesta|es)|tarifa|\bcosto\b|\bplan(es)?\b|contrat(ar|o)|cotiza|totemsystem/i.test(textoEntrante);

      if (pareceQuererPrecio) {
        nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];

        // Mención explícita de "totemsystem" ya es inequívoca — no hace
        // falta preguntar, vamos directo al pitch (o al atajo con carrito,
        // ver más abajo).
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

        // Ambiguo — preguntamos en vez de asumir (ej. "cuánto cuesta" en una
        // demo de catálogo casi siempre es sobre el producto que se está
        // probando, no sobre Totemsystem).
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

      let respuestaMotorReal = null;
      let interactivoMotorReal = null;

      try {
        if (modoOperacion === 'CATALOGO_ROTATIVO') {
          const resultado = await procesarMensajeCatalogoDemo({
            demoAsignada, textoEntrante, mensaje,
          });
          respuestaMotorReal = resultado?.respuestaTexto || null;
          interactivoMotorReal = resultado?.interactivo || null;
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

      const pareceEsperandoConfirmacion = /¿confirmas|\(sí\/no\)|¿confirmo/i.test(respuestaMotorReal || '');

      respuestaTexto = pareceEsperandoConfirmacion
        ? `${respuestaMotorReal}\n\n_(en tu negocio real, el nombre y teléfono del cliente se registran automáticamente desde WhatsApp — no hace falta pedirlos aparte)_`
        : (respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?');
      interactivo = interactivoMotorReal;
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      break;
    }

    // ------------------------------------------------------------
    // NUEVO PASO: desambiguando si "precio" era sobre el negocio simulado
    // o sobre Totemsystem.
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

      // "precio_producto" (tocó el botón), o cualquier otra cosa si
      // contestó con texto libre en vez de tocar un botón — en ambos casos
      // volvemos a la simulación normal y delegamos el mensaje al motor
      // correspondiente, sin volver a activar la detección de precio.
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      try {
        if (modoOperacion === 'CATALOGO_ROTATIVO') {
          const resultado = await procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje });
          respuestaTexto = resultado?.respuestaTexto || 'Cuéntame más — ¿qué te gustaría hacer?';
          interactivo = resultado?.interactivo || null;
        } else {
          const resultado = await procesarMensajeEntrante({
            empresa: empresaDemo, telefonoCliente, textoEntrante, nombreContacto,
          });
          respuestaTexto = resultado?.respuestaTexto || 'Cuéntame más — ¿qué te gustaría hacer?';
          interactivo = resultado?.interactivo || null;
        }
      } catch (error) {
        console.error('[DEMO] Error delegando tras desambiguación, se usa fallback:', error.message);
        respuestaTexto = 'Cuéntame más — ¿qué te gustaría hacer?';
      }
      break;
    }

    // ------------------------------------------------------------
    // PASO 2: personalización + cierre corto (cuando el prospecto escribe
    // sus productos/servicios a mano, en vez de venir de un carrito real).
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

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { paso: nuevoPaso, historialSimulacion: nuevoHistorial },
  });

  return { respuestaTexto, interactivo };
}

module.exports = { procesarMensajeDemo };