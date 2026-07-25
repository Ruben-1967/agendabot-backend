const prisma = require('../lib/prisma');
const { generarRespuestaChatbot } = require('./claude');

const PREGUNTA_OPT_IN = '¿Quieres que te avisemos por acá de promociones y novedades? Responde *Sí* o *No*.';
const ACK_OPT_IN_SI = '¡Perfecto! Te avisaremos por acá de nuestras promociones y novedades. 🙂';
const ACK_OPT_IN_NO = 'Entendido, no te enviaremos avisos de promociones. Igual puedes escribirnos cuando quieras.';

/**
 * Interpreta una respuesta corta de Sí/No. Devuelve true/false/null
 * (null = no se pudo interpretar con confianza, se sigue el flujo normal).
 */
function interpretarSiNo(texto) {
  const limpio = (texto || '').trim().toLowerCase();
  if (/^s[ií]\b/.test(limpio)) return true;
  if (/^no\b/.test(limpio)) return false;
  return null;
}

/**
 * Procesa un mensaje entrante de un cliente para una empresa dada:
 * busca/crea el Cliente y la Conversacion, genera la respuesta con Claude
 * (incluyendo posible uso de herramientas de agenda), y guarda el intercambio.
 *
 * También gestiona el opt-in de campañas embebido en la conversación
 * natural: si el cliente nunca fue preguntado, se agrega la pregunta al
 * final de la primera respuesta; si está pendiente de responder, este
 * turno se revisa primero por un Sí/No corto antes de llamar a Claude.
 *
 * No envía nada por WhatsApp — eso lo decide quien llama a esta función.
 *
 * @param {Object} params
 * @param {Object} params.empresa - Empresa completa, con rubroTemplate incluido.
 * @param {string} params.telefonoCliente
 * @param {string} params.textoEntrante
 * @param {string|null} params.nombreContacto
 * @returns {Promise<{respuestaTexto: string, interactivo: Object|null, cliente: Object}>}
 */
async function procesarMensajeEntrante({ empresa, telefonoCliente, textoEntrante, nombreContacto }) {
  // 1. Buscar o crear el Cliente por teléfono dentro de esa empresa
  let cliente = await prisma.cliente.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente },
  });

  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: {
        empresaId: empresa.id,
        telefono: telefonoCliente,
        nombre: nombreContacto || 'Sin nombre',
      },
    });
  }

  // 2. Buscar o crear la Conversacion activa con este cliente
  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente },
  });

  const historialPrevio = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];

  // 3. Opt-in de campañas: si estamos esperando su respuesta a la pregunta
  // de este mismo tema, revisar ANTES de llamar a Claude.
  let respuestaTexto;
  let interactivo = null;

  if (cliente.optInPreguntaPendiente) {
    const respuesta = interpretarSiNo(textoEntrante);

    if (respuesta !== null) {
      // Respuesta clara -> guardamos, respondemos breve, y no llamamos a Claude
      cliente = await prisma.cliente.update({
        where: { id: cliente.id },
        data: { optInCampanas: respuesta, optInPreguntaPendiente: false },
      });
      respuestaTexto = respuesta ? ACK_OPT_IN_SI : ACK_OPT_IN_NO;

      const mensajesActualizados = [
        ...historialPrevio,
        { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
        { rol: 'asistente', contenido: respuestaTexto, timestamp: new Date().toISOString() },
      ];

      await prisma.conversacion.upsert({
        where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
        update: { mensajes: mensajesActualizados, clienteId: cliente.id },
        create: {
          empresaId: empresa.id,
          clienteId: cliente.id,
          telefono: telefonoCliente,
          mensajes: mensajesActualizados,
        },
      });

      return { respuestaTexto, interactivo: null, cliente };
    }

    // No fue una respuesta clara de Sí/No -> dejamos de esperarla, sin insistir,
    // y seguimos el flujo normal con Claude para este mensaje.
    cliente = await prisma.cliente.update({
      where: { id: cliente.id },
      data: { optInPreguntaPendiente: false },
    });
  }

  // 4. Generar la respuesta con Claude (puede usar herramientas de agenda).
  // Puede venir acompañada de "interactivo" cuando hay horarios reales para
  // mostrar como lista tocable de WhatsApp, en vez de solo texto.
  const resultadoClaude = await generarRespuestaChatbot({
    empresa,
    cliente,
    historial: historialPrevio,
    mensajeEntrante: textoEntrante,
  });

  respuestaTexto = resultadoClaude.texto;
  interactivo = resultadoClaude.interactivo;

  // 5. Si el cliente nunca fue preguntado por el opt-in, agregamos la
  // pregunta al final de esta respuesta (una sola vez en su vida, sin
  // importar cuántas conversaciones tenga después) y marcamos que estamos
  // esperando su respuesta el próximo turno.
  let quedaPreguntaPendiente = false;
  if (!cliente.optInCampanasPreguntado) {
    respuestaTexto = `${respuestaTexto}\n\n${PREGUNTA_OPT_IN}`;
    quedaPreguntaPendiente = true;
  }

  // 6. Guardar el intercambio en la Conversacion. Guardamos siempre la
  // versión en texto (incluso cuando se mostró como lista interactiva) para
  // que el siguiente turno de Claude tenga el contexto completo.
  const mensajesActualizados = [
    ...historialPrevio,
    { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
    { rol: 'asistente', contenido: respuestaTexto, timestamp: new Date().toISOString() },
  ];

  await prisma.conversacion.upsert({
    where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
    update: { mensajes: mensajesActualizados, clienteId: cliente.id },
    create: {
      empresaId: empresa.id,
      clienteId: cliente.id,
      telefono: telefonoCliente,
      mensajes: mensajesActualizados,
    },
  });

  if (quedaPreguntaPendiente) {
    cliente = await prisma.cliente.update({
      where: { id: cliente.id },
      data: { optInCampanasPreguntado: true, optInPreguntaPendiente: true },
    });
  }

  return { respuestaTexto, interactivo, cliente };
}

module.exports = { procesarMensajeEntrante };