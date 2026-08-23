const prisma = require('../lib/prisma');
const { generarRespuestaChatbot } = require('./claude');

// Frases genéricas que preguntan por la lista de servicios, normalizadas
// (sin tildes, minúsculas, sin signos de puntuación). Si el mensaje del
// cliente calza EXACTO con alguna de estas, respondemos directo con la
// lista real de servicios como botones — sin pasar por Claude — porque
// confiarle esta pregunta al modelo ha resultado en que a veces arma la
// lista mezclando contenido de "informacionAdicional" en vez de usar
// únicamente los Servicio reales (ver systemPrompt en claude.js, que sigue
// reforzando esto para el resto de formulaciones no cubiertas acá).
const FRASES_PREGUNTA_SERVICIOS = new Set([
  'servicios',
  'que servicios',
  'que servicios ofrecen',
  'que servicios tienen',
  'que servicios hacen',
  'cuales son sus servicios',
  'cuales son los servicios',
  'que atienden',
  'que hacen',
  'que ofrecen',
  'que servicios ofrecen ustedes',
]);

function normalizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[¿?¡!.,]/g, '')
    .trim();
}

/**
 * Procesa un mensaje entrante de un cliente para una empresa dada:
 * busca/crea el Cliente y la Conversacion, genera la respuesta con Claude
 * (incluyendo posible uso de herramientas de agenda), y guarda el intercambio.
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

  // 2.1. Coexistence: si un humano está interviniendo esta conversación
  // (echo detectado en el webhook, ver server.js), el bot no responde nada
  // — solo persistimos el mensaje del cliente en el historial, igual que
  // siempre, para que el humano (o el bot, cuando se reactive) tenga el
  // contexto completo. Ningún mensaje del cliente reinicia ni cancela la
  // pausa — eso solo lo hace el job de src/jobs/pausaCoexistence.js.
  if (conversacion?.pausadaPorHumanoEn) {
    const mensajesConEsteTurno = [
      ...historialPrevio,
      { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
    ];

    await prisma.conversacion.update({
      where: { id: conversacion.id },
      data: { mensajes: mensajesConEsteTurno, clienteId: cliente.id },
    });

    return { respuestaTexto: null, interactivo: null, cliente };
  }

  let respuestaTexto;
  let interactivo = null;

  // 3. Interceptor determinístico: si el mensaje es una pregunta genérica
  // por los servicios y la empresa tiene Servicio reales cargados,
  // respondemos directo con la lista real como botones, sin pasar por
  // Claude en absoluto para este turno.
  const textoNormalizado = normalizarTexto(textoEntrante);
  if (FRASES_PREGUNTA_SERVICIOS.has(textoNormalizado)) {
    const serviciosReales = await prisma.servicio.findMany({
      where: { empresaId: empresa.id, activo: true },
      orderBy: { nombre: 'asc' },
    });

    if (serviciosReales.length > 0) {
      respuestaTexto = 'Estos son nuestros servicios 👇';
      interactivo = {
        tipo: 'lista_servicios',
        servicios: serviciosReales.map((s) => ({ id: s.id, nombre: s.nombre })),
      };
    }
  }

  // 4. Si el interceptor no aplicó (no coincidió la frase, o la empresa no
  // tiene servicios reales todavía), seguimos el flujo normal con Claude.
  if (respuestaTexto === undefined) {
    const resultadoClaude = await generarRespuestaChatbot({
      empresa,
      cliente,
      historial: historialPrevio,
      mensajeEntrante: textoEntrante,
    });
    respuestaTexto = resultadoClaude.texto;
    interactivo = resultadoClaude.interactivo;
  }

  // 5. Guardar el intercambio en la Conversacion. Guardamos siempre la
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

  return { respuestaTexto, interactivo, cliente };
}

module.exports = { procesarMensajeEntrante };