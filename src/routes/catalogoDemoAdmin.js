// src/routes/catalogoDemoAdmin.js
//
// Administración del Catálogo Visual de la demo comercial (CatalogoDemoItem,
// fijo por RubroTemplate — ver demoEngine.js). Solo para el equipo de
// Multidigital (Vendedor con rolVendedor: 'ADMIN'), nunca para un negocio
// cliente real — por eso requireRolVendedorAdmin, no requireRole('ADMIN')
// (ese es el rol de Usuario de una Empresa, cosa distinta).
//
// Nunca crea ni elimina RubroTemplate — esos ya existen, sembrados de
// antes. Esta pantalla solo administra el switch (catalogoVisualDemoActivo)
// y los items de imagen de cada rubro.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');
const { subirImagenCatalogo, eliminarImagenCatalogo, extraerPublicIdDesdeUrl } = require('../services/cloudinary');

router.use(requireAuth, requireRolVendedorAdmin);

const FORMATOS_VALIDOS = ['image/jpeg', 'image/png'];
const MAX_BYTES_IMAGEN = 5 * 1024 * 1024; // 5MB, límite de WhatsApp para imágenes

// ---------- Rubros ----------

router.get('/rubros', async (req, res) => {
  try {
    const rubros = await prisma.rubroTemplate.findMany({
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { catalogoDemoItems: true } } },
    });
    res.json({ rubros });
  } catch (error) {
    console.error('Error listando rubros de catálogo demo:', error);
    res.status(500).json({ error: 'Error al listar los rubros' });
  }
});

router.patch('/rubros/:id/activo', async (req, res) => {
  try {
    if (typeof req.body.catalogoVisualDemoActivo !== 'boolean') {
      return res.status(400).json({ error: 'catalogoVisualDemoActivo debe ser true o false' });
    }

    const rubro = await prisma.rubroTemplate.findUnique({ where: { id: req.params.id } });
    if (!rubro) {
      return res.status(404).json({ error: 'Rubro no encontrado' });
    }

    const rubroActualizado = await prisma.rubroTemplate.update({
      where: { id: rubro.id },
      data: { catalogoVisualDemoActivo: req.body.catalogoVisualDemoActivo },
      select: { id: true, catalogoVisualDemoActivo: true },
    });

    res.json(rubroActualizado);
  } catch (error) {
    console.error('Error actualizando switch de catálogo demo:', error);
    res.status(500).json({ error: 'Error al actualizar el rubro' });
  }
});

// ---------- Items ----------

router.get('/items', async (req, res) => {
  try {
    const { rubroTemplateId } = req.query;
    if (!rubroTemplateId) {
      return res.status(400).json({ error: 'Falta rubroTemplateId' });
    }

    const items = await prisma.catalogoDemoItem.findMany({
      where: { rubroTemplateId },
      orderBy: { orden: 'asc' },
    });
    res.json({ items });
  } catch (error) {
    console.error('Error listando items de catálogo demo:', error);
    res.status(500).json({ error: 'Error al listar las imágenes' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const { rubroTemplateId, categoria, nombre, descripcion, imagenBase64 } = req.body;

    if (!rubroTemplateId || typeof rubroTemplateId !== 'string') {
      return res.status(400).json({ error: 'Falta rubroTemplateId' });
    }
    if (!categoria || typeof categoria !== 'string' || !categoria.trim()) {
      return res.status(400).json({ error: 'Falta la categoría' });
    }
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre de la imagen' });
    }
    if (!imagenBase64 || typeof imagenBase64 !== 'string') {
      return res.status(400).json({ error: 'Falta la imagen' });
    }

    const matchDataUri = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imagenBase64);
    if (!matchDataUri || !FORMATOS_VALIDOS.includes(matchDataUri[1])) {
      return res.status(400).json({ error: 'Formato de imagen no válido — solo JPEG o PNG' });
    }
    const bytesImagen = Buffer.byteLength(matchDataUri[2], 'base64');
    if (bytesImagen > MAX_BYTES_IMAGEN) {
      return res.status(400).json({ error: 'La imagen supera el máximo de 5MB' });
    }

    const rubro = await prisma.rubroTemplate.findUnique({ where: { id: rubroTemplateId } });
    if (!rubro) {
      return res.status(404).json({ error: 'Rubro no encontrado' });
    }

    // Sin límites de plan acá — dataset fijo y chico, convención de carga,
    // no enforcement duro (ver scripts/seed-catalogo-demo.js).
    const { url } = await subirImagenCatalogo(imagenBase64, `catalogo-demo/${rubroTemplateId}`);

    const item = await prisma.catalogoDemoItem.create({
      data: {
        rubroTemplateId,
        categoria: categoria.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        imagenUrl: url,
      },
    });

    res.status(201).json({ item });
  } catch (error) {
    console.error('Error creando item de catálogo demo:', error);
    res.status(500).json({ error: 'Error al subir la imagen' });
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const item = await prisma.catalogoDemoItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    const data = {};
    if ('categoria' in req.body) {
      if (!req.body.categoria || typeof req.body.categoria !== 'string' || !req.body.categoria.trim()) {
        return res.status(400).json({ error: 'La categoría no puede estar vacía' });
      }
      data.categoria = req.body.categoria.trim();
    }
    if ('nombre' in req.body) {
      if (!req.body.nombre || typeof req.body.nombre !== 'string' || !req.body.nombre.trim()) {
        return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      }
      data.nombre = req.body.nombre.trim();
    }
    if ('descripcion' in req.body) {
      data.descripcion = req.body.descripcion || null;
    }
    if ('activo' in req.body) {
      if (typeof req.body.activo !== 'boolean') {
        return res.status(400).json({ error: 'activo debe ser true o false' });
      }
      data.activo = req.body.activo;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No se envió ningún campo para actualizar' });
    }

    const itemActualizado = await prisma.catalogoDemoItem.update({
      where: { id: item.id },
      data,
    });

    res.json({ item: itemActualizado });
  } catch (error) {
    console.error('Error actualizando item de catálogo demo:', error);
    res.status(500).json({ error: 'Error al actualizar la imagen' });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const item = await prisma.catalogoDemoItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    await prisma.catalogoDemoItem.delete({ where: { id: item.id } });

    const publicId = extraerPublicIdDesdeUrl(item.imagenUrl);
    if (publicId) {
      eliminarImagenCatalogo(publicId).catch((error) => {
        console.error('No se pudo eliminar la imagen en Cloudinary:', error);
      });
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error eliminando item de catálogo demo:', error);
    res.status(500).json({ error: 'Error al eliminar la imagen' });
  }
});

module.exports = router;
