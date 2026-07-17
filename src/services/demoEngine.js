// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta, y en el paso de simulación SÍ delega a los motores reales para que
// la experiencia se sienta auténtica.
//
// Enfoque del guion: no es una demostración de funcionalidad ("mira lo que
// hace"), es un argumento de venta que ataca dos dolores concretos desde el
// primer mensaje — clientes que se pierden por no responder a tiempo, y
// negocios que la gente olvida por no tener presencia constante.
//
// IMPORTANTE: el estado propio de la demo (en qué paso va, historial de la
// simulación) se guarda en el modelo DemoAsignada, NO en Conversacion. El
// motor real de chatbot (chatbotEngine.js / claude.js) usa Conversacion.mensajes
// con su propia forma de datos — si el motor de demo escribiera ahí también,
// ambos se pisarían entre sí.

const prisma = require('../lib/prisma');
const { procesarMensajeEntrante } = require('./chatbotEngine');
const { procesarMensajeCatalogoRotativo } = require('./pedidosEngine');

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar'; // AJUSTAR cuando exista el link real

const PASOS = {
  INICIO: 0,
  SIMULACION_LIBRE: 1,
  ESPERANDO_PRODUCTOS: 2,
  CIERRE_ENVIADO: 3,
};

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return (
      `💳 Esto funciona con créditos prepagados: $149 CLP por mensaje de campaña enviado, ` +
      `mínimo 50 créditos por compra. Pagas solo por lo que realmente envías — nada de mensualidad fija por algo que no sabes cuánto vas a usar.`
    );
  }
  return (
    `💰 Planes desde $9.900 CLP/mes (100 citas incluidas) hasta $49.900 CLP/mes (700 citas incluidas), ` +
    `con 1 UF de hosting al año. Para lo que evita — un cliente perdido casi siempre vale más que eso.`
  );
}

/**
 * Punto de entrada del motor de demo. Se llama en vez de procesarMensajeEntrante /
 * procesarMensajeCatalogoRotativo cuando el mensaje llega al número de pruebas.
 *
 * @param {object} params
 * @param {object} params.demoAsignada - registro completo de DemoAsignada (con empresaDemo.rubroTemplate incluido)
 */
async function procesarMensajeDemo({ demoAsignada, telefonoCliente, mensaje, nombreContacto }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;
  const paso = demoAsignada.paso || PASOS.INICIO;
  const historial = Array.isArray(demoAsignada.historialSimulacion) ? demoAsignada.historialSimulacion : [];

  const textoEntrante = mensaje.type === 'button'
    ? (mensaje.button?.text || '')
    : (mensaje.type === 'interactive'
      ? (mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '')
      : (mensaje.text?.body || ''));

  let respuestaTexto;
  let nuevoPaso = paso;
  let nuevoHistorial = historial;

  switch (paso) {
    // ------------------------------------------------------------
    // PASO 0: identidad + el gancho de venta, directo al dolor real,
    // no una explicación de producto.
    // ------------------------------------------------------------
    case PASOS.INICIO: {
      respuestaTexto =
        `¡Hola${nombreContacto ? ` ${nombreContacto}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
        `Antes de nada: te voy a responder como si fuera *"${empresaDemo.nombre}"* — es solo para ` +
        `que esta prueba se sienta real, no representamos tu negocio ni usamos tu marca para nada más.\n\n` +
        `Una pregunta antes de mostrarte algo: ¿cuántos clientes crees que se te escapan cada semana ` +
        `solo porque te escribieron un sábado a las once de la noche, o un lunes a mil cosas, y nadie ` +
        `alcanzó a contestar a tiempo? La mayoría no insiste — simplemente le compra al que sí respondió.\n\n` +
        `Pruébalo tú mismo ahora — escríbeme algo, como si fueras un cliente tuyo contactando a tu propio negocio 👇`;
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      break;
    }

    // ------------------------------------------------------------
    // PASO 1: delega al motor real para que la interacción sea genuina.
    // Tras 2 turnos, la transición ataca el segundo dolor (negocio ausente).
    // ------------------------------------------------------------
    case PASOS.SIMULACION_LIBRE: {
      let respuestaMotorReal = null;

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
        }
      } catch (error) {
        // Si el motor real falla por cualquier motivo, la demo sigue con un
        // mensaje de respaldo en vez de caerse en silencio.
        console.error('[DEMO] Error delegando al motor real, se usa fallback:', error.message);
        respuestaMotorReal = null;
      }

      nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
      const turnosDeSimulacion = nuevoHistorial.length;

      if (turnosDeSimulacion >= 2) {
        respuestaTexto =
          `${respuestaMotorReal ? respuestaMotorReal + '\n\n' : ''}` +
          `¿Viste? Respondí al segundo, sin que nadie de tu equipo tocara el celular — ni de día ni de ` +
          `madrugada. Así se siente para tus clientes tener tu negocio siempre presente, en vez de ir ` +
          `olvidándose de ti porque nunca hay nadie cuando lo necesitan.\n\n` +
          `Hagámoslo ahora con tu negocio real: cuéntame 2 o 3 productos o servicios que *realmente* ` +
          `ofreces, separados por coma.`;
        nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
      } else {
        respuestaTexto = respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?';
      }
      break;
    }

    // ------------------------------------------------------------
    // PASO 2: personalización + cierre, en tono de vendedor que remata
    // el argumento, no de lista de funcionalidades.
    // ------------------------------------------------------------
    case PASOS.ESPERANDO_PRODUCTOS: {
      const itemsIngresados = textoEntrante
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);

      const listaFormateada = itemsIngresados.length > 0
        ? itemsIngresados.map((item) => `• ${item}`).join('\n')
        : '• (no alcancé a leer productos claros, pero así se vería igual)';

      const ejemploPersonalizado = modoOperacion === 'CATALOGO_ROTATIVO'
        ? `🛍️ *Catálogo de hoy — ${empresaDemo.nombre}*\n\n${listaFormateada}\n\nResponde con el nombre de lo que quieras pedir 😊`
        : `📅 *${empresaDemo.nombre}*\n\nCon tus servicios reales, así se vería la conversación:\n\n${listaFormateada}\n\n¿Cuál te gustaría agendar?`;

      respuestaTexto =
        `Así se vería con tu propio negocio 👇\n\n${ejemploPersonalizado}\n\n` +
        `Piénsalo así: mientras tú duermes, atiendes a otro cliente, o simplemente vives tu vida, esto ` +
        `sigue ahí — respondiendo, agendando, recordándole a la gente que existes. Los negocios casi ` +
        `nunca pierden clientes por mal servicio; los pierden por estar ausentes justo en el momento ` +
        `en que alguien los necesitaba.\n\n` +
        `${textoPrecios(modoOperacion)}\n\n` +
        `📎 Mira el detalle completo (panel, planes, y cómo se ve por dentro):\n${LINK_LANDING}\n\n` +
        `¿Seguimos? 👉 ${LINK_CONTRATACION}`;

      nuevoPaso = PASOS.CIERRE_ENVIADO;
      break;
    }

    case PASOS.CIERRE_ENVIADO:
    default: {
      respuestaTexto =
        `¡Cualquier duda que te quede, escríbenos directo! 🙌 También puedes revisar todo de nuevo acá: ${LINK_LANDING}`;
      break;
    }
  }

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { paso: nuevoPaso, historialSimulacion: nuevoHistorial },
  });

  return { respuestaTexto };
}

module.exports = { procesarMensajeDemo };