// Motor de catálogo rotativo SIMPLIFICADO, exclusivo para demos
// comerciales. A diferencia de pedidosEngine.js (el motor real), este lee
// Producto directo, mantiene un "carrito" simple por demo
// (DemoAsignada.carritoDemoJson) y retorna {respuestaTexto, interactivo}.
// No se usa NUNCA para negocios reales.

const prisma = require('../lib/prisma');
const { decodificarFilaProductoDemo } = require('./whatsapp');

const MAX_PRODUCTOS_EN_LISTA = 10; // límite real de WhatsApp por lista interactiva

function construirResumenCarrito(carrito) {
  const resumen = carrito
    .map((it) => `• ${it.cantidad}x ${it.nombre} ($${it.precio * it.cantidad})`)
    .join('\n');
  const total = carrito.reduce((acc, it) => acc + it.cantidad * it.precio, 0);
  return { resumen, total };
}

function agregarOSumarItem(carrito, producto) {
  const existente = carrito.find((it) => it.productoId === producto.id);
  if (existente) {
    return carrito.map((it) =>
      it.productoId === producto.id ? { ...it, cantidad: it.cantidad + 1 } : it
    );
  }
  return [...carrito, { productoId: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad: 1 }];
}

/**
 * @param {Object} params
 * @param {Object} params.demoAsignada - incluye empresaDemo y carritoDemoJson
 * @param {string} params.textoEntrante
 * @param {Object} params.mensaje - mensaje crudo del webhook (para decodificar selección de lista)
 * @returns {Promise<{respuestaTexto: string, interactivo: Object|null}>}
 */
async function procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const carritoActual = Array.isArray(demoAsignada.carritoDemoJson) ? demoAsignada.carritoDemoJson : [];
  const nombreCompra = demoAsignada.nombreProspecto || 'el cliente';

  // 1) Selección de un producto desde la lista interactiva — se detecta por
  // el id codificado, no por el título (WhatsApp lo trunca a 24 caracteres
  // y podría no calzar exacto con el nombre real del producto).
  if (mensaje?.type === 'interactive') {
    const listReplyId = mensaje.interactive?.list_reply?.id;
    const productoId = decodificarFilaProductoDemo(listReplyId);

    if (productoId) {
      const producto = await prisma.producto.findUnique({ where: { id: productoId } });
      if (!producto) {
        return {
          respuestaTexto: 'Ese producto ya no está disponible, disculpa. Escríbeme "menú" para ver las opciones actuales.',
          interactivo: null,
        };
      }

      const nuevoCarrito = agregarOSumarItem(carritoActual, producto);
      await prisma.demoAsignada.update({
        where: { id: demoAsignada.id },
        data: { carritoDemoJson: nuevoCarrito },
      });

      const { resumen, total } = construirResumenCarrito(nuevoCarrito);
      return {
        respuestaTexto: `¡Agregado! ${producto.nombre} — $${producto.precio}\n\nPedido de *${nombreCompra}* hasta ahora:\n${resumen}\n\nTotal: $${total}\n\nEscribe "menú" para agregar algo más, o "listo" para ver el resumen final.`,
        interactivo: null,
      };
    }
  }

  // 2) "listo" — muestra el resumen final del carrito acumulado
  if (/^\s*listo\s*$/i.test(textoEntrante || '')) {
    if (carritoActual.length === 0) {
      return {
        respuestaTexto: 'Todavía no has agregado nada. Escríbeme "menú" para ver el catálogo.',
        interactivo: null,
      };
    }
    const { resumen, total } = construirResumenCarrito(carritoActual);
    return {
      respuestaTexto: `📋 Resumen del pedido de *${nombreCompra}*:\n\n${resumen}\n\nTotal: $${total}\n\n¡Así de simple se vería un pedido real por WhatsApp! 🙌`,
      interactivo: null,
    };
  }

  // 3) Reconocimiento amplio de intención de ver el catálogo. En este modo
  // de demo no hay otra funcionalidad real más que mostrar productos, así
  // que cualquier mensaje que no sea un simple agradecimiento cae por
  // defecto en mostrar el menú — mejor mostrar de más que dejar sin
  // respuesta útil (soluciona que "Tienen pasteles?" no activara nada).
  const esSoloAgradecimiento = /^\s*(ok|okey|gracias|dale|bien|listo|perfecto)\s*[.!]?\s*$/i.test(textoEntrante || '');

  if (!esSoloAgradecimiento) {
    const productos = await prisma.producto.findMany({
      where: { empresaId: empresaDemo.id, activo: true },
      orderBy: { nombre: 'asc' },
      take: MAX_PRODUCTOS_EN_LISTA,
    });

    if (productos.length === 0) {
      return {
        respuestaTexto: `Todavía no tenemos productos cargados para esta demo de "${empresaDemo.nombre}".`,
        interactivo: null,
      };
    }

    return {
      respuestaTexto: `Esto es lo que tenemos disponible hoy en ${empresaDemo.nombre} 👇`,
      interactivo: {
        tipo: 'lista_productos_demo',
        productos: productos.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio })),
      },
    };
  }

  return {
    respuestaTexto: '¡De nada! Escríbeme "menú" cuando quieras ver el catálogo de nuevo.',
    interactivo: null,
  };
}

module.exports = { procesarMensajeCatalogoDemo };