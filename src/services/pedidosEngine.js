// Motor de conversación para empresas de rubro CATALOGO_ROTATIVO
// (panadería gourmet y similares). A diferencia del chatbot de agendamiento
// (chatbotEngine.js), aquí el negocio inicia el contacto con una plantilla
// aprobada por Meta, y este motor solo reacciona a:
//   1) el clic en el botón de esa plantilla -> muestra el menú del día (lista interactiva)
//   2) la selección de un producto en esa lista -> pregunta cuántos quiere
//   3) la respuesta numérica a esa pregunta -> fija la cantidad y muestra el resumen
//   4) cualquier otro texto libre -> guía al cliente a tocar el botón

const prisma = require('../lib/prisma');
const { sendWhatsAppTextMessage, sendWhatsAppInteractiveList } = require('./whatsapp');

const CANTIDAD_MAXIMA_POR_PRODUCTO = 50;

function inicioDeHoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function finDeHoy() {
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  return hoy;
}

function esNumeroSimple(texto) {
  return /^\s*\d+\s*$/.test(texto || '');
}

/**
 * Busca el envío de campaña que ya fue disparado hoy para esta empresa
 * (el que contiene el catálogo vigente ahora mismo).
 */
async function buscarEnvioActivoDeHoy(empresaId) {
  return prisma.envioRealizado.findFirst({
    where: {
      campana: { empresaId },
      estado: 'ENVIADO',
      fechaProgramada: { gte: inicioDeHoy(), lte: finDeHoy() },
    },
    orderBy: { fechaHoraEnvio: 'desc' },
  });
}

async function obtenerOCrearCliente({ empresaId, telefono, nombreContacto }) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono } });
  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: { empresaId, telefono, nombre: nombreContacto || telefono },
    });
  }
  return cliente;
}

async function enviarMenuDelDia({ empresa, cliente, envio, accessToken }) {
  const productos = envio.productosOfrecidosJson || [];

  if (productos.length === 0) {
    await sendWhatsAppTextMessage({
      phoneNumberId: empresa.whatsappNumeroId,
      to: cliente.telefono,
      accessToken,
      text: 'Por ahora no hay productos disponibles para pedir. ¡Vuelve a escribir más tarde!',
    });
    return;
  }

  await sendWhatsAppInteractiveList({
    phoneNumberId: empresa.whatsappNumeroId,
    to: cliente.telefono,
    accessToken,
    textoCuerpo: `¡Hola${cliente.nombre ? ' ' + cliente.nombre : ''}! Esto es lo que tenemos disponible hoy en ${empresa.nombre} 👇`,
    textoBoton: 'Ver menú',
    filas: productos.map((p) => ({
      id: `PRODUCTO:${p.productoId}:${envio.id}`,
      titulo: p.nombre,
      descripcion: `$${p.precio} / ${p.unidad}`,
    })),
  });
}

/**
 * Arma el texto de resumen del pedido (items + total) y el pie con las
 * opciones de seguir. Se usa tanto después de fijar una cantidad como,
 * en el futuro, desde cualquier otro punto que necesite mostrar el estado
 * actual del pedido.
 */
function construirResumenPedido(pedidoConItems) {
  const resumen = pedidoConItems.items
    .map((it) => `• ${it.cantidad}x ${it.producto.nombre} ($${it.precioUnitario * it.cantidad})`)
    .join('\n');
  const total = pedidoConItems.items.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0);
  return { resumen, total };
}

async function enviarResumenYPreguntarAlgoMas({ empresa, cliente, pedidoId, accessToken }) {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: { items: { include: { producto: true } } },
  });
  const { resumen, total } = construirResumenPedido(pedido);

  await sendWhatsAppTextMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: cliente.telefono,
    accessToken,
    text: `Tu pedido de hoy:\n\n${resumen}\n\nTotal: $${total}\n\n¿Quieres agregar algo más? Escríbenos "menú" para ver las opciones de nuevo, o "listo" para confirmar.`,
  });
}

/**
 * El cliente eligió un producto de la lista. En vez de sumarlo de inmediato,
 * lo agrega con cantidad provisoria 1 y PREGUNTA cuántos quiere en total —
 * así alguien que quiere 5 no tiene que tocar la lista 5 veces.
 */
async function registrarSeleccionProducto({ empresa, cliente, envio, productoId, accessToken }) {
  const productos = envio.productosOfrecidosJson || [];
  const productoSnapshot = productos.find((p) => p.productoId === productoId);

  if (!productoSnapshot) {
    await sendWhatsAppTextMessage({
      phoneNumberId: empresa.whatsappNumeroId,
      to: cliente.telefono,
      accessToken,
      text: 'Ese producto ya no está disponible en este envío, disculpa. Escríbenos si quieres ver otras opciones.',
    });
    return;
  }

  // Un Pedido por cliente por envío — se van acumulando ítems si elige varias veces.
  let pedido = await prisma.pedido.findFirst({
    where: { envioRealizadoId: envio.id, clienteId: cliente.id },
    include: { items: true },
  });

  if (!pedido) {
    pedido = await prisma.pedido.create({
      data: { empresaId: empresa.id, clienteId: cliente.id, envioRealizadoId: envio.id },
      include: { items: true },
    });
  }

  const itemExistente = pedido.items.find((it) => it.productoId === productoId);

  if (!itemExistente) {
    await prisma.pedidoItem.create({
      data: { pedidoId: pedido.id, productoId, cantidad: 1, precioUnitario: productoSnapshot.precio },
    });
  }

  // Marcamos que estamos esperando la cantidad de ESTE producto —
  // el próximo mensaje numérico del cliente se interpretará como tal.
  await prisma.pedido.update({
    where: { id: pedido.id },
    data: { productoPendienteId: productoId },
  });

  await sendWhatsAppTextMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: cliente.telefono,
    accessToken,
    text: `¡Agregado! ¿Cuántos ${productoSnapshot.nombre} quieres en total? Responde con el número (o escribe "listo" si con 1 te basta).`,
  });
}

/**
 * El cliente respondió con un número mientras había una pregunta de
 * cantidad pendiente — fija esa cantidad y muestra el resumen actualizado.
 */
async function fijarCantidadPendiente({ empresa, cliente, pedido, textoEntrante, accessToken }) {
  const cantidad = Math.min(CANTIDAD_MAXIMA_POR_PRODUCTO, Math.max(1, parseInt(textoEntrante, 10)));

  const item = await prisma.pedidoItem.findFirst({
    where: { pedidoId: pedido.id, productoId: pedido.productoPendienteId },
  });

  if (item) {
    await prisma.pedidoItem.update({ where: { id: item.id }, data: { cantidad } });
  }

  await prisma.pedido.update({ where: { id: pedido.id }, data: { productoPendienteId: null } });

  await enviarResumenYPreguntarAlgoMas({ empresa, cliente, pedidoId: pedido.id, accessToken });
}

/**
 * Punto de entrada único desde el webhook para empresas CATALOGO_ROTATIVO.
 * A diferencia del chatbot de agendamiento, este motor envía sus propias
 * respuestas directamente (los distintos tipos de mensaje —texto vs. lista
 * interactiva— no encajan en un solo "respuestaTexto" genérico).
 */
async function procesarMensajeCatalogoRotativo({ empresa, telefonoCliente, mensaje, nombreContacto }) {
  const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(`Empresa ${empresa.nombre} no tiene whatsappToken configurado.`);
    return;
  }

  const cliente = await obtenerOCrearCliente({ empresaId: empresa.id, telefono: telefonoCliente, nombreContacto });

  // 1) Selección de un producto en la lista interactiva
  if (mensaje.type === 'interactive' && mensaje.interactive?.type === 'list_reply') {
    const [prefijo, productoId, envioId] = mensaje.interactive.list_reply.id.split(':');
    if (prefijo !== 'PRODUCTO') return;

    const envio = await prisma.envioRealizado.findUnique({ where: { id: envioId } });
    if (!envio) return;

    await registrarSeleccionProducto({ empresa, cliente, envio, productoId, accessToken });
    return;
  }

  // 2) Respuesta numérica: solo tiene sentido si hay una cantidad pendiente
  if (mensaje.type === 'text' && esNumeroSimple(mensaje.text?.body)) {
    const pedidoConPendiente = await prisma.pedido.findFirst({
      where: { clienteId: cliente.id, productoPendienteId: { not: null } },
      orderBy: { actualizadoEn: 'desc' },
    });

    if (pedidoConPendiente) {
      await fijarCantidadPendiente({
        empresa,
        cliente,
        pedido: pedidoConPendiente,
        textoEntrante: mensaje.text.body,
        accessToken,
      });
      return;
    }
    // Si no había ninguna pregunta de cantidad pendiente, un número suelto
    // no significa nada especial — sigue al flujo normal más abajo.
  }

  // 3) "listo": confirma el pedido tal como está (lo pendiente sin responder queda en 1)
  if (mensaje.type === 'text' && /^\s*listo\s*$/i.test(mensaje.text?.body || '')) {
    const pedidoActivo = await prisma.pedido.findFirst({
      where: { clienteId: cliente.id, empresaId: empresa.id },
      orderBy: { actualizadoEn: 'desc' },
    });

    if (pedidoActivo) {
      if (pedidoActivo.productoPendienteId) {
        await prisma.pedido.update({ where: { id: pedidoActivo.id }, data: { productoPendienteId: null } });
      }
      await sendWhatsAppTextMessage({
        phoneNumberId: empresa.whatsappNumeroId,
        to: cliente.telefono,
        accessToken,
        text: `¡Pedido confirmado! Te avisamos cuándo está listo para retirar en ${empresa.nombre} 🥖`,
      });
      return;
    }
  }

  // 4) Clic en el botón de la plantilla, o texto libre pidiendo el menú
  const textoPideMenu = mensaje.type === 'button'
    || (mensaje.type === 'text' && /menu|menú|hola|pedido/i.test(mensaje.text?.body || ''));

  if (textoPideMenu) {
    const envio = await buscarEnvioActivoDeHoy(empresa.id);

    if (!envio) {
      await sendWhatsAppTextMessage({
        phoneNumberId: empresa.whatsappNumeroId,
        to: cliente.telefono,
        accessToken,
        text: 'Todavía no hay un menú activo para hoy. ¡Avísanos más tarde o espera nuestro próximo aviso!',
      });
      return;
    }

    await enviarMenuDelDia({ empresa, cliente, envio, accessToken });
    return;
  }

  // 5) Cualquier otro texto libre: guiar al cliente
  await sendWhatsAppTextMessage({
    phoneNumberId: empresa.whatsappNumeroId,
    to: cliente.telefono,
    accessToken,
    text: 'Escríbenos "menú" para ver los productos disponibles hoy y hacer tu pedido.',
  });
}

module.exports = { procesarMensajeCatalogoRotativo };
