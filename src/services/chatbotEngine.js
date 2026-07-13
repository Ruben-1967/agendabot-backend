const prisma = require('../lib/prisma');
const { generarRespuestaChatbot } = require('./claude');

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
 * @returns {Promise<{respuestaTexto: string, cliente: Object}>}
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

  const historialPrevio = conversacion?.mensajes || [];

  // 3. Generar la respuesta con Claude (puede usar herramientas de agenda)
  const respuestaTexto = await generarRespuestaChatbot({
    empresa,
    cliente,
    historial: historialPrevio,
    mensajeEntrante: textoEntrante,
  });

  // 4. Guardar el intercambio en la Conversacion
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

  return { respuestaTexto, cliente };
}

module.exports = { procesarMensajeEntrante };
