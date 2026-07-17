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
// con su propia forma de datos (un array plano para el historial de Claude) —
// si el motor de demo escribiera ahí también, ambos se pisarían entre sí.

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

function textoValorAgregado(rubroNombre) {
  return (
    `✨ Algunas cosas que ya viste en acción:\n\n` +
    `• Responde al instante, 24/7 — nunca más un cliente esperando\n` +
    `• Se adapta a tu rubro (${rubroNombre}), no al revés\n` +
    `• Tú decides a quién le llega cada campaña, y cuánto gastas en cada envío\n` +
    `• Todo lo que pasa por WhatsApp queda ordenado en un panel, sin planillas sueltas`
  );
}

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return (
      `💳 Este modo funciona con créditos prepagados: $149 CLP por mensaje de campaña enviado, ` +
      `mínimo 50 créditos por compra. Pagas solo por lo que realmente envías.`
    );
  }
  return (
    `💰 Planes desde $9.900 CLP/mes (100 citas incluidas) hasta $49.900 CLP/mes (700 citas incluidas). ` +
    `Todos incluyen 1 UF de hosting al año.`
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
    case PASOS.INICIO: {
      respuestaTexto =
        `¡Hola${nombreContacto ? ` ${nombreContacto}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
        `Antes de todo: vas a ver que te respondo como si fuera *"${empresaDemo.nombre}"* — ` +
        `usamos ese nombre solo para que esta demo se sienta real. No representamos a tu negocio ` +
        `ni nos apropiamos de tu marca, es únicamente para esta prueba.\n\n` +
        `Ahora sí — escríbeme algo, como si fueras un cliente tuyo contactando a tu propio negocio 👇`;
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      break;
    }

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
        // Si el motor real falla (ej. la empresa demo no tiene datos suficientes
        // configurados todavía — servicios, recursos agendables, etc.), no dejamos
        // que se caiga toda la demo: seguimos con una respuesta genérica.
        console.error('[DEMO] Error delegando al motor real, se usa fallback:', error.message);
        respuestaMotorReal = null;
      }

      nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
      const turnosDeSimulacion = nuevoHistorial.length;

      if (turnosDeSimulacion >= 2) {
        respuestaTexto =
          `${respuestaMotorReal ? respuestaMotorReal + '\n\n' : ''}` +
          `Ya viste cómo responde con datos de ejemplo. Ahora te toca a ti 🙌\n\n` +
          `Cuéntame 2 o 3 productos o servicios *reales* que ofreces, separados por coma, ` +
          `y te muestro un ejemplo armado con tu propio negocio.`;
        nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
      } else {
        respuestaTexto = respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?';
      }
      break;
    }

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
        : `📅 *${empresaDemo.nombre}*\n\nCon tus servicios reales, el bot ofrecería agendar para:\n\n${listaFormateada}\n\n¿Cuál te gustaría agendar?`;

      respuestaTexto =
        `Así se vería con tu propio negocio 👇\n\n${ejemploPersonalizado}\n\n` +
        `${textoValorAgregado(empresaDemo.rubroTemplate.nombre)}\n\n` +
        `${textoPrecios(modoOperacion)}\n\n` +
        `📎 Mira el detalle completo (panel, planes, y cómo se ve por dentro):\n${LINK_LANDING}\n\n` +
        `¿Listo para partir? 👉 ${LINK_CONTRATACION}`;

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
