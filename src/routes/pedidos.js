const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN', 'RECEPCION'));

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

// GET /pedidos/hoy — consolidado de pedidos de hoy: total por producto
// (para saber cuánto hornear/preparar) + detalle por cliente.
router.get('/hoy', async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: {
        empresaId: req.usuario.empresaId,
        creadoEn: { gte: inicioDeHoy(), lte: finDeHoy() },
        estado: { not: 'CANCELADO' },
      },
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        items: { include: { producto: { select: { nombre: true, unidad: true } } } },
      },
      orderBy: { creadoEn: 'asc' },
    });

    // Consolidado por producto (cuánto preparar en total)
    const consolidadoPorProducto = {};
    for (const pedido of pedidos) {
      for (const item of pedido.items) {
        const clave = item.producto.nombre;
        if (!consolidadoPorProducto[clave]) {
          consolidadoPorProducto[clave] = { nombre: clave, unidad: item.producto.unidad, cantidadTotal: 0 };
        }
        consolidadoPorProducto[clave].cantidadTotal += item.cantidad;
      }
    }

    const totalGeneral = pedidos.reduce(
      (acc, p) => acc + p.items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0),
      0
    );

    res.json({
      fecha: new Date().toISOString().slice(0, 10),
      totalPedidos: pedidos.length,
      totalGeneral,
      consolidadoPorProducto: Object.values(consolidadoPorProducto),
      pedidos: pedidos.map((p) => ({
        id: p.id,
        cliente: p.cliente,
        estado: p.estado,
        items: p.items.map((it) => ({
          producto: it.producto.nombre,
          unidad: it.producto.unidad,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
        })),
        total: p.items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo pedidos de hoy:', error);
    res.status(500).json({ error: 'Error al obtener los pedidos de hoy' });
  }
});

// PATCH /pedidos/:id — cambiar estado (ej. marcar como LISTO o ENTREGADO)
router.patch('/:id', async (req, res) => {
  try {
    const pedido = await prisma.pedido.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { estado } = req.body;
    const estadosValidos = ['PENDIENTE', 'CONFIRMADO', 'LISTO', 'ENTREGADO', 'CANCELADO'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `estado inválido, debe ser uno de: ${estadosValidos.join(', ')}` });
    }

    const actualizado = await prisma.pedido.update({ where: { id: pedido.id }, data: { estado } });
    res.json({ pedido: actualizado });
  } catch (error) {
    console.error('Error actualizando pedido:', error);
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});

module.exports = router;
