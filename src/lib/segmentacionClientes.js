const prisma = require('./prisma');

/**
 * Resuelve la lista de clientes que deberían recibir un envío de esta
 * campaña, bifurcando la fuente de historial según el modo de operación
 * de la empresa:
 *   - CATALOGO_ROTATIVO -> historial de Pedido/PedidoItem (productoId)
 *   - AGENDAMIENTO      -> historial de Venta (categoriaProducto)
 *
 * Si la campaña no está segmentada, es simplemente todos los clientes
 * con optInCampanas=true.
 */
async function resolverClientesDestino(empresaId, campana, modoOperacion) {
  const todos = await prisma.cliente.findMany({
    where: { empresaId, optInCampanas: true, telefono: { not: null } },
  });

  if (!campana.segmentada) return todos;

  const dias = campana.segmentoDias || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  if (modoOperacion === 'AGENDAMIENTO') {
    const clientesConHistorial = await prisma.cliente.findMany({
      where: { id: { in: todos.map((c) => c.id) } },
      include: {
        ventas: {
          where: { empresaId, creadoEn: { gte: desde } },
        },
      },
    });

    return clientesConHistorial
      .filter((cliente) => {
        const totalGastado = cliente.ventas.reduce((acc, v) => acc + v.monto, 0);

        const cumpleMonto = campana.segmentoMontoMinimoClp
          ? totalGastado >= campana.segmentoMontoMinimoClp
          : true;

        const cumpleCategoria = campana.segmentoCategoriasProducto && campana.segmentoCategoriasProducto.length > 0
          ? cliente.ventas.some((v) => campana.segmentoCategoriasProducto.includes(v.categoriaProducto))
          : true;

        return cumpleMonto && cumpleCategoria;
      })
      .map(({ ventas, ...cliente }) => cliente);
  }

  // CATALOGO_ROTATIVO (comportamiento original, sin cambios)
  const clientesConHistorial = await prisma.cliente.findMany({
    where: { id: { in: todos.map((c) => c.id) } },
    include: {
      pedidos: {
        where: { empresaId, creadoEn: { gte: desde }, estado: { not: 'CANCELADO' } },
        include: { items: true },
      },
    },
  });

  return clientesConHistorial
    .filter((cliente) => {
      const totalGastado = cliente.pedidos.reduce(
        (acc, p) => acc + p.items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0),
        0
      );

      const cumpleMonto = campana.segmentoMontoMinimoClp
        ? totalGastado >= campana.segmentoMontoMinimoClp
        : true;

      const cumpleProducto = campana.segmentoProductoIds && campana.segmentoProductoIds.length > 0
        ? cliente.pedidos.some((p) => p.items.some((it) => campana.segmentoProductoIds.includes(it.productoId)))
        : true;

      return cumpleMonto && cumpleProducto;
    })
    .map(({ pedidos, ...cliente }) => cliente);
}

/**
 * Resuelve los destinatarios finales de un envío, dando prioridad a una
 * lista explícita de clienteIds (elegida ad-hoc en el panel "Nueva campaña"
 * del día de hoy) por sobre la segmentación persistente de la campaña.
 */
async function resolverDestinatariosFinales(empresaId, campana, modoOperacion, clienteIdsOverride) {
  if (Array.isArray(clienteIdsOverride) && clienteIdsOverride.length > 0) {
    return prisma.cliente.findMany({
      where: {
        id: { in: clienteIdsOverride },
        empresaId,
        optInCampanas: true,
        telefono: { not: null },
      },
    });
  }
  return resolverClientesDestino(empresaId, campana, modoOperacion);
}

/**
 * Obtiene el modoOperacion vigente de una empresa (vive en su RubroTemplate,
 * no directo en Empresa).
 */
async function obtenerModoOperacion(empresaId) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: { rubroTemplate: true },
  });
  if (!empresa) return null;
  return empresa.rubroTemplate.modoOperacion;
}

module.exports = { resolverClientesDestino, resolverDestinatariosFinales, obtenerModoOperacion };