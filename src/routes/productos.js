const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas de productos requieren sesión de ADMIN o RECEPCION
router.use(requireAuth, requireRole('ADMIN', 'RECEPCION'));

// GET /productos — catálogo completo de la empresa del usuario logueado
router.get('/', async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      where: { empresaId: req.usuario.empresaId },
      orderBy: { nombre: 'asc' },
    });
    res.json({ productos });
  } catch (error) {
    console.error('Error listando productos:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// POST /productos — crear un producto nuevo
router.post('/', async (req, res) => {
  try {
    const { nombre, descripcion, precio, unidad } = req.body;

    if (!nombre || precio == null) {
      return res.status(400).json({ error: 'Faltan campos: nombre, precio' });
    }

    const producto = await prisma.producto.create({
      data: {
        empresaId: req.usuario.empresaId,
        nombre,
        descripcion: descripcion || null,
        precio: Number(precio),
        unidad: unidad || 'unidad',
      },
    });

    res.status(201).json({ producto });
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PATCH /productos/:id — editar nombre/precio/descripcion/activo
router.patch('/:id', async (req, res) => {
  try {
    const producto = await prisma.producto.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const { nombre, descripcion, precio, unidad, activo } = req.body;

    const actualizado = await prisma.producto.update({
      where: { id: producto.id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(descripcion !== undefined && { descripcion }),
        ...(precio !== undefined && { precio: Number(precio) }),
        ...(unidad !== undefined && { unidad }),
        ...(activo !== undefined && { activo: Boolean(activo) }),
      },
    });

    res.json({ producto: actualizado });
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /productos/:id — en la práctica, mejor desactivar (activo=false) si
// ya tiene pedidos asociados; se intenta borrar y si falla por FK, se avisa.
router.delete('/:id', async (req, res) => {
  try {
    const producto = await prisma.producto.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await prisma.producto.delete({ where: { id: producto.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(409).json({
      error: 'No se pudo eliminar (probablemente ya tiene pedidos asociados). Prueba desactivarlo en vez de eliminarlo.',
    });
  }
});

module.exports = router;
