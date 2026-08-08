// src/routes/servicios.js
//
// CRUD de Servicio (tipos de atención que ofrece la empresa, ej. "Examen
// de la vista"). Mismo patrón que src/routes/productos.js.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'RECEPCION'));

// GET /servicios — todos los servicios de la empresa (activos e inactivos)
router.get('/', async (req, res) => {
  try {
    const servicios = await prisma.servicio.findMany({
      where: { empresaId: req.usuario.empresaId },
      include: {
        recursos: { include: { recurso: { select: { id: true, nombre: true } } } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json({ servicios });
  } catch (error) {
    console.error('Error listando servicios:', error);
    res.status(500).json({ error: 'Error al listar servicios' });
  }
});

// POST /servicios — crear un servicio nuevo
router.post('/', async (req, res) => {
  try {
    const { nombre, duracionMinutos } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre del servicio' });
    }
    if (duracionMinutos != null && (Number(duracionMinutos) <= 0)) {
      return res.status(400).json({ error: 'duracionMinutos debe ser mayor a 0 si se especifica' });
    }

    const servicio = await prisma.servicio.create({
      data: {
        empresaId: req.usuario.empresaId,
        nombre: nombre.trim(),
        duracionMinutos: duracionMinutos != null ? Number(duracionMinutos) : null,
      },
    });

    res.status(201).json({ servicio });
  } catch (error) {
    console.error('Error creando servicio:', error);
    res.status(500).json({ error: 'Error al crear servicio' });
  }
});

// PATCH /servicios/:id — editar nombre/duración/activo
router.patch('/:id', async (req, res) => {
  try {
    const servicio = await prisma.servicio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const { nombre, duracionMinutos, activo, requiereProfesionalEspecifico, recursoIds } = req.body;

    // Si viene recursoIds, validamos que todos pertenezcan a esta empresa
    // antes de tocar nada — evita que un id de otra empresa (o inventado)
    // quede vinculado por error.
    if (recursoIds !== undefined) {
      if (!Array.isArray(recursoIds)) {
        return res.status(400).json({ error: 'recursoIds debe ser un arreglo' });
      }
      if (recursoIds.length > 0) {
        const validos = await prisma.recursoAgendable.count({
          where: { id: { in: recursoIds }, empresaId: req.usuario.empresaId },
        });
        if (validos !== recursoIds.length) {
          return res.status(400).json({ error: 'Uno o más recursoIds no pertenecen a esta empresa' });
        }
      }
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      const svc = await tx.servicio.update({
        where: { id: servicio.id },
        data: {
          ...(nombre !== undefined && { nombre: nombre.trim() }),
          ...(duracionMinutos !== undefined && { duracionMinutos: duracionMinutos != null ? Number(duracionMinutos) : null }),
          ...(activo !== undefined && { activo: Boolean(activo) }),
          ...(requiereProfesionalEspecifico !== undefined && { requiereProfesionalEspecifico: Boolean(requiereProfesionalEspecifico) }),
        },
      });

      if (recursoIds !== undefined) {
        await tx.servicioRecurso.deleteMany({ where: { servicioId: servicio.id } });
        if (recursoIds.length > 0) {
          await tx.servicioRecurso.createMany({
            data: recursoIds.map((recursoAgendableId) => ({ servicioId: servicio.id, recursoAgendableId })),
          });
        }
      }

      return svc;
    });

    const servicioConRecursos = await prisma.servicio.findUnique({
      where: { id: actualizado.id },
      include: { recursos: { include: { recurso: { select: { id: true, nombre: true } } } } },
    });

    res.json({ servicio: servicioConRecursos });
  } catch (error) {
    console.error('Error actualizando servicio:', error);
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
});

// DELETE /servicios/:id — si ya tiene citas asociadas, la FK lo va a
// impedir; en ese caso conviene desactivarlo en vez de borrarlo.
router.delete('/:id', async (req, res) => {
  try {
    const servicio = await prisma.servicio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    await prisma.servicio.delete({ where: { id: servicio.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando servicio:', error);
    res.status(409).json({
      error: 'No se pudo eliminar (probablemente ya tiene citas asociadas). Prueba desactivarlo en vez de eliminarlo.',
    });
  }
});

module.exports = router;