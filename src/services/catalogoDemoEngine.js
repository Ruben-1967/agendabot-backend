// Motor de catálogo rotativo SIMPLIFICADO, exclusivo para demos
// comerciales. A diferencia de pedidosEngine.js (el motor real), este lee
// Producto directo, mantiene un "carrito" simple por demo
// (DemoAsignada.carritoDemoJson) y un checkout simulado propio
// (DemoAsignada.checkoutDemoJson). No se usa NUNCA para negocios reales —
// pedidosEngine.js no tiene hoy forma de pago, tipo de entrega, ni regla
// de despacho; esto es solo para la demo.

const prisma = require('../lib/prisma');
const { decodificarFilaProductoDemo, decodificarFilaCantidadDemo } = require('./whatsapp');

const MAX_PRODUCTOS_EN_LISTA = 10;
const OPCIONES_CANTIDAD_RAPIDA = [1, 2, 3, 4, 5, 6];

// Regla de despacho de EJEMPLO para la demo — no configurable todavía por
// negocio real (eso requeriría campos nuevos en Empresa + panel). El monto
// mínimo, la tarifa de envío (o si es gratis) y la zona los define cada
// negocio en la vida real; acá son solo valores de muestra.
const REGLA_DESPACHO_MINIMO_CLP = 15000;
const REGLA_DESPACHO_TARIFA_CLP = 2500;
const REGLA_DESPACHO_ZONA = 'la Región Metropolitana';

const OPCIONES_FORMA_PAGO = [
  { id: 'pago_efectivo', titulo: 'Efectivo', descripcion: 'Pagas al recibir/retirar' },
  { id: 'pago_transferencia', titulo: 'Transferencia', descripcion: 'Te paso los datos al confirmar' },
  { id: 'pago_tarjeta', titulo: 'Tarjeta', descripcion: 'Débito o crédito al recibir/retirar' },
];

const OPCIONES_TIPO_ENTREGA = [
  { id: 'entrega_retiro', titulo: 'Retiro en tienda', descripcion: 'Sin costo adicional' },
  {
    id: 'entrega_domicilio',
    titulo: 'Despacho a domicilio',
    descripcion: `Mín. $${REGLA_DESPACHO_MINIMO_CLP.toLocaleString('es-CL')} + envío $${REGLA_DESPACHO_TARIFA_CLP.toLocaleString('es-CL')}`,
  },
];

// Etiquetas de unidad de medida — el campo `unidad` en Producto ya existe
// en producción ("unidad" | "kg" | "docena" | "porción", etc.); acá solo
// mapeamos las que usamos en las plantillas de demo a un texto lindo.
const ETIQUETAS_UNIDAD = {
  unidad: { capitalizada: 'Unidad', singular: 'unidad', plural: 'unidades' },
  kg: { capitalizada: 'Kilo', singular: 'kilo', plural: 'kilos' },
  litro: { capitalizada: 'Litro', singular: 'litro', plural: 'litros' },
};

function etiquetaUnidad(unidad) {
  return ETIQUETAS_UNIDAD[unidad] || { capitalizada: 'Otro', singular: 'unidad', plural: 'unidades' };
}

function formatearCantidad(cantidad, unidad) {
  const etiqueta = etiquetaUnidad(unidad);
  const palabra = cantidad === 1 ? etiqueta.singular : etiqueta.plural;
  return unidad === 'unidad' ? `${cantidad}x` : `${cantidad} ${palabra} de`;
}

function construirResumenCarrito(carrito) {
  const resumen = carrito
    .map((it) => `• ${formatearCantidad(it.cantidad, it.unidad)} ${it.nombre} ($${(it.precio * it.cantidad).toLocaleString('es-CL')})`)
    .join('\n');
  const total = carrito.reduce((acc, it) => acc + it.cantidad * it.precio, 0);
  return { resumen, total };
}

function agregarConCantidad(carrito, producto, cantidad) {
  const existente = carrito.find((it) => it.productoId === producto.id);
  if (existente) {
    return carrito.map((it) =>
      it.productoId === producto.id ? { ...it, cantidad: it.cantidad + cantidad } : it
    );
  }
  return [...carrito, { productoId: producto.id, nombre: producto.nombre, precio: producto.precio, unidad: producto.unidad || 'unidad', cantidad }];
}

async function construirInteractivoCatalogo(empresaDemo) {
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
      productos: productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        unidad: p.unidad || 'unidad',
      })),
    },
  };
}

function construirInteractivoCantidad(producto) {
  const etiqueta = etiquetaUnidad(producto.unidad);
  return {
    respuestaTexto: `¿Cuántos ${etiqueta.plural} de *${producto.nombre}* quieres?`,
    interactivo: {
      tipo: 'lista_cantidad_demo',
      productoId: producto.id,
      nombreProducto: producto.nombre,
      unidad: producto.unidad || 'unidad',
      opciones: [
        ...OPCIONES_CANTIDAD_RAPIDA.map((n) => ({ cantidad: n, titulo: `${n} ${n > 1 ? etiqueta.plural : etiqueta.singular}` })),
        { cantidad: 'otra', titulo: 'Otra cantidad', descripcion: 'Escríbela tú' },
      ],
    },
  };
}

async function agregarProductoYResponder({ demoAsignada, carritoActual, producto, cantidad }) {
  const nuevoCarrito = agregarConCantidad(carritoActual, producto, cantidad);
  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { carritoDemoJson: nuevoCarrito, checkoutDemoJson: null },
  });

  const { resumen, total } = construirResumenCarrito(nuevoCarrito);
  const etiqueta = etiquetaUnidad(producto.unidad);
  const cantidadTexto = formatearCantidad(cantidad, producto.unidad);
  return {
    respuestaTexto: `¡Agregado! ${cantidadTexto} ${producto.nombre} — $${(producto.precio * cantidad).toLocaleString('es-CL')}\n\nPedido hasta ahora:\n${resumen}\n\nTotal: $${total.toLocaleString('es-CL')}\n\nEscribe "menú" para agregar algo más, o "listo" para cerrar el pedido.`,
    interactivo: null,
  };
}

/**
 * @param {Object} params
 * @param {Object} params.demoAsignada - incluye empresaDemo, carritoDemoJson, checkoutDemoJson
 * @param {string} params.textoEntrante
 * @param {Object} params.mensaje - mensaje crudo del webhook
 * @returns {Promise<{respuestaTexto: string, interactivo: Object|null}>}
 */
async function procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const carritoActual = Array.isArray(demoAsignada.carritoDemoJson) ? demoAsignada.carritoDemoJson : [];
  const checkout = demoAsignada.checkoutDemoJson || {};
  const paso = checkout.paso || null;
  const idFilaElegida = mensaje?.type === 'interactive' ? mensaje.interactive?.list_reply?.id : null;

  // Cancelar el checkout/selección en curso y volver al catálogo, en cualquier paso.
  if (paso && /^\s*men[uú]\s*$/i.test(textoEntrante || '')) {
    await prisma.demoAsignada.update({ where: { id: demoAsignada.id }, data: { checkoutDemoJson: null } });
    return construirInteractivoCatalogo(empresaDemo);
  }

  // ------------------------------------------------------------
  // Esperando la CANTIDAD de un producto recién elegido — primero por
  // botón/lista (rápido), y si tocó "otra", por texto libre. Los productos
  // por kilo/litro admiten decimales (ej. "1.5"); los de unidad, solo enteros.
  // ------------------------------------------------------------
  if (paso === 'ESPERANDO_CANTIDAD') {
    const unidadPendiente = checkout.unidadPendiente || 'unidad';
    const permiteDecimal = unidadPendiente === 'kg' || unidadPendiente === 'litro';
    const etiqueta = etiquetaUnidad(unidadPendiente);

    const seleccionCantidad = mensaje?.type === 'interactive' ? decodificarFilaCantidadDemo(idFilaElegida) : null;

    if (seleccionCantidad && seleccionCantidad.productoId === checkout.productoPendienteId) {
      if (seleccionCantidad.cantidadRaw === 'otra') {
        return {
          respuestaTexto: `Perfecto, escríbeme la cantidad de ${etiqueta.plural} que quieres${permiteDecimal ? ' (ej. 1.5)' : ' (ej. 8)'}.`,
          interactivo: null,
        };
      }

      const cantidad = parseFloat(seleccionCantidad.cantidadRaw);
      const producto = await prisma.producto.findUnique({ where: { id: checkout.productoPendienteId } });
      if (!producto) {
        await prisma.demoAsignada.update({ where: { id: demoAsignada.id }, data: { checkoutDemoJson: null } });
        return {
          respuestaTexto: 'Ese producto ya no está disponible, disculpa. Escríbeme "menú" para ver las opciones actuales.',
          interactivo: null,
        };
      }
      return agregarProductoYResponder({ demoAsignada, carritoActual, producto, cantidad });
    }

    // Texto libre (llegó acá porque tocó "Otra cantidad", o escribió
    // directamente sin usar la lista).
    const patron = permiteDecimal ? /^\d{1,3}(\.\d{1,2})?$/ : /^\d{1,3}$/;
    const match = (textoEntrante || '').trim().match(patron);
    const cantidad = match ? parseFloat(match[0]) : null;

    if (!cantidad || cantidad <= 0 || cantidad > 999) {
      return {
        respuestaTexto: `¿Cuántos ${etiqueta.plural} quieres? Escríbeme solo el número${permiteDecimal ? ' (ej. 1.5)' : ' (ej. 8)'}.`,
        interactivo: null,
      };
    }

    const producto = await prisma.producto.findUnique({ where: { id: checkout.productoPendienteId } });
    if (!producto) {
      await prisma.demoAsignada.update({ where: { id: demoAsignada.id }, data: { checkoutDemoJson: null } });
      return {
        respuestaTexto: 'Ese producto ya no está disponible, disculpa. Escríbeme "menú" para ver las opciones actuales.',
        interactivo: null,
      };
    }
    return agregarProductoYResponder({ demoAsignada, carritoActual, producto, cantidad });
  }

  // ------------------------------------------------------------
  // Checkout: nombre → forma de pago → retiro/domicilio → (dirección) → resumen.
  // ------------------------------------------------------------
  if (paso === 'ESPERANDO_NOMBRE') {
    const nombre = (textoEntrante || '').trim();
    if (nombre.length < 2) {
      return { respuestaTexto: 'No alcancé a leer bien tu nombre — ¿me lo repites?', interactivo: null };
    }

    await prisma.demoAsignada.update({
      where: { id: demoAsignada.id },
      data: { checkoutDemoJson: { ...checkout, paso: 'ESPERANDO_FORMA_PAGO', nombre } },
    });

    return {
      respuestaTexto: `Gracias, ${nombre} 👍 ¿Cómo prefieres pagar?\n\n_(Hoy te muestro estas opciones — Totemsystem también puede integrar un link de pago online, ej. Flow o Webpay, para cobrar directo desde este chat)_`,
      interactivo: { tipo: 'lista_forma_pago', opciones: OPCIONES_FORMA_PAGO },
    };
  }

  if (paso === 'ESPERANDO_FORMA_PAGO') {
    const opcion = OPCIONES_FORMA_PAGO.find((o) => o.id === idFilaElegida)
      || OPCIONES_FORMA_PAGO.find((o) => new RegExp(o.titulo, 'i').test(textoEntrante || ''));

    if (!opcion) {
      return {
        respuestaTexto: '¿Me eliges una de estas opciones para el pago? 👇',
        interactivo: { tipo: 'lista_forma_pago', opciones: OPCIONES_FORMA_PAGO },
      };
    }

    await prisma.demoAsignada.update({
      where: { id: demoAsignada.id },
      data: { checkoutDemoJson: { ...checkout, paso: 'ESPERANDO_TIPO_ENTREGA', formaPago: opcion.titulo } },
    });

    return {
      respuestaTexto:
        `¿Retiras en tienda o prefieres despacho a domicilio?\n\n` +
        `_(Cada negocio decide si ofrece despacho, define su propio monto mínimo de compra, y elige si el envío es ` +
        `gratis o tiene un costo fijo — este ejemplo usa mínimo $${REGLA_DESPACHO_MINIMO_CLP.toLocaleString('es-CL')} ` +
        `y envío de $${REGLA_DESPACHO_TARIFA_CLP.toLocaleString('es-CL')})_`,
      interactivo: { tipo: 'lista_tipo_entrega', opciones: OPCIONES_TIPO_ENTREGA },
    };
  }

  if (paso === 'ESPERANDO_TIPO_ENTREGA') {
    const opcion = OPCIONES_TIPO_ENTREGA.find((o) => o.id === idFilaElegida)
      || OPCIONES_TIPO_ENTREGA.find((o) => new RegExp(o.titulo.split(' ')[0], 'i').test(textoEntrante || ''));

    if (!opcion) {
      return {
        respuestaTexto: '¿Retiro en tienda o despacho a domicilio? Elige una opción 👇',
        interactivo: { tipo: 'lista_tipo_entrega', opciones: OPCIONES_TIPO_ENTREGA },
      };
    }

    if (opcion.id === 'entrega_domicilio') {
      const { total } = construirResumenCarrito(carritoActual);
      if (total < REGLA_DESPACHO_MINIMO_CLP) {
        return {
          respuestaTexto:
            `El despacho a domicilio requiere un mínimo de $${REGLA_DESPACHO_MINIMO_CLP.toLocaleString('es-CL')} ` +
            `(tu pedido va en $${total.toLocaleString('es-CL')}). Escribe "menú" para agregar más productos, ` +
            `o elige retiro en tienda 👇`,
          interactivo: { tipo: 'lista_tipo_entrega', opciones: OPCIONES_TIPO_ENTREGA },
        };
      }

      await prisma.demoAsignada.update({
        where: { id: demoAsignada.id },
        data: { checkoutDemoJson: { ...checkout, paso: 'ESPERANDO_DIRECCION', tipoEntrega: opcion.titulo, costoEnvio: REGLA_DESPACHO_TARIFA_CLP } },
      });

      return {
        respuestaTexto: `Hacemos despacho solo dentro de ${REGLA_DESPACHO_ZONA} por ahora. ¿A qué dirección lo enviamos?`,
        interactivo: null,
      };
    }

    return finalizarPedido({ demoAsignada, empresaDemo, carritoActual, checkout: { ...checkout, tipoEntrega: opcion.titulo, costoEnvio: 0 } });
  }

  if (paso === 'ESPERANDO_DIRECCION') {
    const direccion = (textoEntrante || '').trim();
    if (direccion.length < 5) {
      return { respuestaTexto: '¿Me confirmas la dirección completa (calle, número, comuna)?', interactivo: null };
    }
    return finalizarPedido({ demoAsignada, empresaDemo, carritoActual, checkout: { ...checkout, direccion } });
  }

  // ------------------------------------------------------------
  // Sin checkout en curso: selección de producto, "listo", o catálogo.
  // ------------------------------------------------------------
  if (mensaje?.type === 'interactive') {
    const productoId = decodificarFilaProductoDemo(idFilaElegida);
    if (productoId) {
      const producto = await prisma.producto.findUnique({ where: { id: productoId } });
      if (!producto) {
        return {
          respuestaTexto: 'Ese producto ya no está disponible, disculpa. Escríbeme "menú" para ver las opciones actuales.',
          interactivo: null,
        };
      }

      await prisma.demoAsignada.update({
        where: { id: demoAsignada.id },
        data: { checkoutDemoJson: { paso: 'ESPERANDO_CANTIDAD', productoPendienteId: producto.id, unidadPendiente: producto.unidad || 'unidad' } },
      });

      return construirInteractivoCantidad(producto);
    }
  }

  if (/^\s*listo\s*$/i.test(textoEntrante || '')) {
    if (carritoActual.length === 0) {
      return {
        respuestaTexto: 'Todavía no has agregado nada. Escríbeme "menú" para ver el catálogo.',
        interactivo: null,
      };
    }

    await prisma.demoAsignada.update({
      where: { id: demoAsignada.id },
      data: { checkoutDemoJson: { paso: 'ESPERANDO_NOMBRE' } },
    });

    return {
      respuestaTexto: 'Perfecto, para completar tu pedido dime tu *nombre completo*.',
      interactivo: null,
    };
  }

  const esSoloAgradecimiento = /^\s*(ok|okey|gracias|dale|bien|listo|perfecto)\s*[.!]?\s*$/i.test(textoEntrante || '');
  if (!esSoloAgradecimiento) {
    return construirInteractivoCatalogo(empresaDemo);
  }

  return {
    respuestaTexto: '¡De nada! Escríbeme "menú" cuando quieras ver el catálogo de nuevo.',
    interactivo: null,
  };
}

async function finalizarPedido({ demoAsignada, empresaDemo, carritoActual, checkout }) {
  const { resumen, total } = construirResumenCarrito(carritoActual);
  const costoEnvio = checkout.costoEnvio || 0;
  const totalFinal = total + costoEnvio;

  const lineaEnvio = checkout.direccion
    ? `\n• Envío${costoEnvio === 0 ? ' (gratis)' : ''}: $${costoEnvio.toLocaleString('es-CL')}`
    : '';

  const respuestaTexto =
    `📋 *Resumen de tu pedido en ${empresaDemo.nombre}*\n\n${resumen}${lineaEnvio}\n\nTotal: $${totalFinal.toLocaleString('es-CL')}\n\n` +
    `• Nombre: ${checkout.nombre}\n` +
    `• Forma de pago: ${checkout.formaPago}\n` +
    `• Entrega: ${checkout.tipoEntrega}${checkout.direccion ? `\n• Dirección: ${checkout.direccion}` : ''}\n\n` +
    `✅ ¡Pedido confirmado!\n\n` +
    `Y algo más que le encanta a los negocios: pueden mandar campañas segmentadas automáticamente por WhatsApp — ` +
    `por ejemplo, solo a quienes ya compraron antes, o a quienes gastan sobre cierto monto — sin elegir cliente por cliente.`;

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { carritoDemoJson: [], checkoutDemoJson: null },
  });

  return { respuestaTexto, interactivo: null };
}

module.exports = { procesarMensajeCatalogoDemo };