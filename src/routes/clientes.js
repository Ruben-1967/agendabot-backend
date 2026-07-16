// src/routes/clientes.js
//
// GET /clientes/segmentacion
// Devuelve, por cada cliente de la empresa, sus métricas de compra en un período,
// ya filtradas según los query params. Alimenta el panel de segmentación.
//
// Query params (todos opcionales):
//   dias              -> tamaño del período a analizar, en días (default 30)
//   montoMinimo       -> excluye clientes que gastaron menos que esto en el período
//   minPedidos        -> excluye clientes con menos pedidos que esto en el período
//   productoId        -> solo clientes que compraron este producto al menos una vez en el período
//   diasSinComprar    -> solo clientes cuya última compra fue hace AL MENOS este número de días
//                        (o que nunca han comprado). Útil para campañas de reactivación.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get(
  '/segmentacion',
  requireAuth,
  requireRole('ADMIN', 'RECEPCION'),
  async (req, res) => {
    try {
      const empresaId = req.usuario.empresaId;

      const dias = parseInt(req.query.dias) || 30;
      const montoMinimo = req.query.montoMinimo ? parseFloat(req.query.montoMinimo) : null;
      const minPedidos = req.query.minPedidos ? parseInt(req.query.minPedidos) : null;
      const productoId = req.query.productoId || null;
      const diasSinComprar = req.query.diasSinComprar ? parseInt(req.query.diasSinComprar) : null;

      const fechaInicioPeriodo = new Date();
      fechaInicioPeriodo.setDate(fechaInicioPeriodo.getDate() - dias);

      // Nota de escala: para carteras grandes conviene migrar esto a una
      // query agregada en SQL. Para el volumen actual, esto es simple y
      // suficientemente rápido.
      const clientes = await prisma.cliente.findMany({
        where: { empresaId },
        include: {
          pedidos: {
            where: {
              creadoEn: { gte: fechaInicioPeriodo },
              estado: { not: 'CANCELADO' },
            },
            include: {
              items: {
                include: { producto: true },
              },
            },
          },
        },
      });

      // Última compra de SIEMPRE (no solo del período), para poder calcular
      // "días sin comprar" incluso si el cliente no compró nada reciente.
      const ultimasCompras = await prisma.pedido.groupBy({
        by: ['clienteId'],
        where: {
          clienteId: { in: clientes.map((c) => c.id) },
          estado: { not: 'CANCELADO' },
        },
        _max: { creadoEn: true },
      });
      const mapaUltimaCompra = new Map(
        ultimasCompras.map((u) => [u.clienteId, u._max.creadoEn])
      );

      const hoy = new Date();

      let segmentados = clientes.map((c) => {
        const totalGastado = c.pedidos.reduce(
          (sumaPedido, p) =>
            sumaPedido +
            p.items.reduce((sumaItem, i) => sumaItem + i.cantidad * i.precioUnitario, 0),
          0
        );

        const numPedidos = c.pedidos.length;

        const conteoProductos = {}; // productoId -> { nombre, cantidad }
        c.pedidos.forEach((p) =>
          p.items.forEach((i) => {
            if (!conteoProductos[i.productoId]) {
              conteoProductos[i.productoId] = { nombre: i.producto.nombre, cantidad: 0 };
            }
            conteoProductos[i.productoId].cantidad += i.cantidad;
          })
        );
        const topEntry = Object.entries(conteoProductos).sort(
          (a, b) => b[1].cantidad - a[1].cantidad
        )[0];
        const productoTopId = topEntry ? topEntry[0] : null;
        const productoTopNombre = topEntry ? topEntry[1].nombre : null;

        const comproProductoFiltrado = productoId
          ? c.pedidos.some((p) => p.items.some((i) => i.productoId === productoId))
          : true;

        const ultimaCompraFecha = mapaUltimaCompra.get(c.id) || null;
        const diasDesdeUltimaCompra = ultimaCompraFecha
          ? Math.floor((hoy - new Date(ultimaCompraFecha)) / (1000 * 60 * 60 * 24))
          : null; // null = nunca ha comprado

        return {
          clienteId: c.id,
          nombre: c.nombre,
          telefono: c.telefono,
          numPedidos,
          totalGastado,
          productoTopId,
          productoTopNombre,
          ultimaCompraFecha,
          diasDesdeUltimaCompra,
          _comproProductoFiltrado: comproProductoFiltrado,
        };
      });

      // Aplicar filtros
      if (montoMinimo !== null) {
        segmentados = segmentados.filter((c) => c.totalGastado >= montoMinimo);
      }
      if (minPedidos !== null) {
        segmentados = segmentados.filter((c) => c.numPedidos >= minPedidos);
      }
      if (productoId) {
        segmentados = segmentados.filter((c) => c._comproProductoFiltrado);
      }
      if (diasSinComprar !== null) {
        segmentados = segmentados.filter(
          (c) => c.diasDesdeUltimaCompra === null || c.diasDesdeUltimaCompra >= diasSinComprar
        );
      }

      segmentados = segmentados.map(({ _comproProductoFiltrado, ...resto }) => resto);

      res.json({
        periodoDias: dias,
        totalClientes: segmentados.length,
        clientes: segmentados,
      });
    } catch (error) {
      console.error('Error en /clientes/segmentacion:', error);
      res.status(500).json({ error: 'Error al calcular la segmentación de clientes' });
    }
  }
);

module.exports = router;