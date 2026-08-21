// src/routes/catalogo.js
//
// Catálogo Visual: categorías e imágenes que cada empresa puede cargar para
// que AgendaBot las ofrezca durante conversaciones de indagación (ver
// systemPrompt en services/claude.js). Todo bajo /empresa/catalogo.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { subirImagenCatalogo, eliminarImagenCatalogo, extraerPublicIdDesdeUrl } = require('../services/cloudinary');
const { LIMITES_CATALOGO_POR_PLAN } = require('../config/planes');

router.use(requireAuth, requireRole('ADMIN'));

const FORMATOS_VALIDOS = ['image/jpeg', 'image/png'];
const MAX_BYTES_IMAGEN = 5 * 1024 * 1024; // 5MB, límite de WhatsApp para imágenes

function limitesDelPlan(req) {
  return LIMITES_CATALOGO_POR_PLAN[req.usuario.plan] || LIMITES_CATALOGO_POR_PLAN.PLAN_A;
}

// ---------- Categorías ----------

router.get('/categorias', async (req, res) => {
  try {
    const [categorias, totalImagenes, empresa] = await Promise.all([
      prisma.catalogoCategoria.findMany({
        where: { empresaId: req.usuario.empresaId },
        orderBy: { orden: 'asc' },
        include: { _count: { select: { items: true } } },
      }),
      prisma.catalogoItem.count({ where: { empresaId: req.usuario.empresaId } }),
      prisma.empresa.findUnique({
        where: { id: req.usuario.empresaId },
        select: { catalogoVisualActivo: true },
      }),
    ]);
    res.json({
      categorias,
      limites: limitesDelPlan(req),
      totalImagenes,
      catalogoVisualActivo: empresa.catalogoVisualActivo,
    });
  } catch (error) {
    console.error('Error listando categorías de catálogo:', error);
    res.status(500).json({ error: 'Error al listar las categorías' });
  }
});

router.post('/categorias', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre de la categoría' });
    }

    const categoria = await prisma.catalogoCategoria.create({
      data: { empresaId: req.usuario.empresaId, nombre: nombre.trim() },
    });

    res.status(201).json({ categoria });
  } catch (error) {
    console.error('Error creando categoría de catálogo:', error);
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

router.delete('/categorias/:id', async (req, res) => {
  try {
    const categoria = await prisma.catalogoCategoria.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
      include: { _count: { select: { items: true } } },
    });

    if (!categoria) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    if (categoria._count.items > 0) {
      return res.status(400).json({ error: 'Esta categoría tiene imágenes — vacíala antes de eliminarla' });
    }

    await prisma.catalogoCategoria.delete({ where: { id: categoria.id } });
    res.status(204).end();
  } catch (error) {
    console.error('Error eliminando categoría de catálogo:', error);
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

// ---------- Items ----------

router.get('/items', async (req, res) => {
  try {
    const { categoriaId } = req.query;
    const where = { empresaId: req.usuario.empresaId };
    if (categoriaId) where.categoriaId = categoriaId;

    const items = await prisma.catalogoItem.findMany({
      where,
      orderBy: { creadoEn: 'asc' },
    });
    res.json({ items });
  } catch (error) {
    console.error('Error listando items de catálogo:', error);
    res.status(500).json({ error: 'Error al listar las imágenes' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const { nombre, categoriaId, descripcion, imagenBase64 } = req.body;

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre de la imagen' });
    }
    if (!categoriaId || typeof categoriaId !== 'string') {
      return res.status(400).json({ error: 'Falta la categoría' });
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

    const categoria = await prisma.catalogoCategoria.findFirst({
      where: { id: categoriaId, empresaId: req.usuario.empresaId },
    });
    if (!categoria) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    // Validar límites de plan ANTES de subir a Cloudinary, para no gastar
    // cuota si la validación va a fallar igual.
    const limites = limitesDelPlan(req);
    const [totalEmpresa, totalCategoria] = await Promise.all([
      prisma.catalogoItem.count({ where: { empresaId: req.usuario.empresaId } }),
      prisma.catalogoItem.count({ where: { categoriaId } }),
    ]);

    if (totalCategoria >= limites.maxPorCategoria) {
      return res.status(400).json({ error: `Alcanzaste el máximo de ${limites.maxPorCategoria} imágenes para esta categoría en tu plan actual` });
    }
    if (totalEmpresa >= limites.maxTotal) {
      return res.status(400).json({ error: `Alcanzaste el máximo de ${limites.maxTotal} imágenes en tu plan actual` });
    }

    const { url } = await subirImagenCatalogo(imagenBase64, req.usuario.empresaId);

    const item = await prisma.catalogoItem.create({
      data: {
        empresaId: req.usuario.empresaId,
        categoriaId,
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        imagenUrl: url,
      },
    });

    res.status(201).json({ item });
  } catch (error) {
    console.error('Error creando item de catálogo:', error);
    res.status(500).json({ error: 'Error al subir la imagen' });
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const item = await prisma.catalogoItem.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    const data = {};
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

    const itemActualizado = await prisma.catalogoItem.update({
      where: { id: item.id },
      data,
    });

    res.json({ item: itemActualizado });
  } catch (error) {
    console.error('Error actualizando item de catálogo:', error);
    res.status(500).json({ error: 'Error al actualizar la imagen' });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const item = await prisma.catalogoItem.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    await prisma.catalogoItem.delete({ where: { id: item.id } });

    // Best-effort: si no se puede derivar el public_id o falla el borrado en
    // Cloudinary, el registro igual queda eliminado de la base — no bloqueamos
    // la respuesta por esto.
    const publicId = extraerPublicIdDesdeUrl(item.imagenUrl);
    if (publicId) {
      eliminarImagenCatalogo(publicId).catch((error) => {
        console.error('No se pudo eliminar la imagen en Cloudinary:', error);
      });
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error eliminando item de catálogo:', error);
    res.status(500).json({ error: 'Error al eliminar la imagen' });
  }
});

module.exports = router;
