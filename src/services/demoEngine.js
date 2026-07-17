// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta, y en el paso de simulación SÍ delega a los motores reales para que
// la experiencia se sienta auténtica.
//
// Estado de la conversación: se guarda en el campo `mensajes` (Json) del
// modelo Conversacion ya existente, agregando un campo `demoStep` dentro de
// ese mismo JSON para no tener que tocar el schema de Conversacion.
//
// AJUSTAR: los links de cierre (landing, contratación) y los textos de valor
// agregado — están escritos como ejemplo, ajústalos a tu gusto.

const prisma = require('../lib/prisma');
const { procesarMensajeEntrante } = require('./chatbotEngine');
const { procesarMensajeCatalogoRotativo } = require('./pedidosEngine');

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar'; // AJUSTAR cuando exista el link real

const PASOS = {
  INICIO: 0,
  ESPERANDO_PRODUCTOS: 1,
  SIMULACION_LIBRE: 2,
  CIERRE_ENVIADO: 3,
};

async function obtenerOCrearConversacionDemo(empresaDemo, telefonoCliente) {
  let conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: empresaDemo.id, telefono: telefonoCliente },
  });

  if (!conversacion) {
    conversacion = await prisma.conversacion.create({
      data: {
        empresaId: empresaDemo.id,
        telefono: telefonoCliente,
        mensajes: { demoStep: PASOS.INICIO, historial: [] },
      },
    });
  }

  return conversacion;
}

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
 */
async function procesarMensajeDemo({ empresaDemo, telefonoCliente, mensaje, nombreContacto }) {
  const conversacion = await obtenerOCrearConversacionDemo(empresaDemo, telefonoCliente);
  const estado = conversacion.mensajes || { demoStep: PASOS.INICIO, historial: [] };
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;

  const textoEntrante = mensaje.type === 'button'
    ? (mensaje.button?.text || '')
    : (mensaje.type === 'interactive'
      ? (mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '')
      : (mensaje.text?.body || ''));

  let respuestaTexto;

  switch (estado.demoStep) {
    case PASOS.INICIO: {
      respuestaTexto =
        `¡Hola${nombreContacto ? ` ${nombreContacto}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
        `Antes de todo: vas a ver que te respondo como si fuera *"${empresaDemo.nombre}"* — ` +
        `usamos ese nombre solo para que esta demo se sienta real. No representamos a tu negocio ` +
        `ni nos apropiamos de tu marca, es únicamente para esta prueba.\n\n` +
        `Ahora sí — escríbeme algo, como si fueras un cliente tuyo contactando a tu propio negocio 👇`;
      estado.demoStep = PASOS.SIMULACION_LIBRE;
      break;
    }

    case PASOS.SIMULACION_LIBRE: {
      let respuestaMotorReal;

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

      const historial = estado.historial || [];
      historial.push({ rol: 'prospecto', texto: textoEntrante });
      const turnosDeSimulacion = historial.filter((h) => h.rol === 'prospecto').length;

      if (turnosDeSimulacion >= 2) {
        respuestaTexto =
          `${respuestaMotorReal ? respuestaMotorReal + '\n\n' : ''}` +
          `Ya viste cómo responde con datos de ejemplo. Ahora te toca a ti 🙌\n\n` +
          `Cuéntame 2 o 3 productos o servicios *reales* que ofreces, separados por coma, ` +
          `y te muestro un ejemplo armado con tu propio negocio.`;
        estado.demoStep = PASOS.ESPERANDO_PRODUCTOS;
      } else {
        respuestaTexto = respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?';
      }

      estado.historial = historial;
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

      estado.demoStep = PASOS.CIERRE_ENVIADO;
      break;
    }

    case PASOS.CIERRE_ENVIADO:
    default: {
      respuestaTexto =
        `¡Cualquier duda que te quede, escríbenos directo! 🙌 También puedes revisar todo de nuevo acá: ${LINK_LANDING}`;
      break;
    }
  }

  await prisma.conversacion.update({
    where: { id: conversacion.id },
    data: { mensajes: estado },
  });

  return { respuestaTexto };
}

module.exports = { procesarMensajeDemo };