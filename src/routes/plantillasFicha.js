// src/routes/plantillasFicha.js
//
// Catálogo fijo de PlantillaFicha, mantenido por MultiDigital — el negocio
// elige entre estas al crear/editar un Servicio, no diseña campos libres.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'RECEPCION'));

// GET /plantillas-ficha — todas las plantillas activas, con sus campos
// visibles para que el negocio compare antes de elegir. El panel filtra
// por rubroSugerido si quiere sugerir primero las relevantes, pero esta
// ruta siempre devuelve el catálogo completo (permitir ver todas, per diseño).
router.get('/', async (req, res) => {
  try {
    const plantillas = await prisma.plantillaFicha.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, camposFicha: true, rubroSugerido: true },
      orderBy: { nombre: 'asc' },
    });
    res.json({ plantillas });
  } catch (error) {
    console.error('Error listando plantillas de ficha:', error);
    res.status(500).json({ error: 'Error al listar las plantillas de ficha' });
  }
});

module.exports = router;
