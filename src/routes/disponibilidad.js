/**
 * src/routes/disponibilidad.js
 * 
 * Endpoints para obtener disponibilidad de slots
 * GET /disponibilidad/:recursoId
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { obtenerDisponibilidad, validarSlot } = require('../lib/disponibilidadService');

/**
 * GET /disponibilidad/:recursoId
 * 
 * Retorna slots disponibles para un recurso en un rango de fechas
 * 
 * Query params:
 * - fechaDesde: YYYY-MM-DD (default: hoy)
 * - fechaHasta: YYYY-MM-DD (default: hoy + 30 días)
 */

router.get('/:recursoId', requireAuth, async (req, res) => {

  try {
    const { recursoId } = req.params;
    const { fechaDesde, fechaHasta } = req.query;

    // Validar fechas si se proporcionan
    let desde = new Date();
    let hasta = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (fechaDesde) {
      desde = new Date(fechaDesde);
      if (isNaN(desde.getTime())) {
        return res.status(400).json({ error: 'fechaDesde inválida (YYYY-MM-DD)' });
      }
    }

    if (fechaHasta) {
      hasta = new Date(fechaHasta);
      if (isNaN(hasta.getTime())) {
        return res.status(400).json({ error: 'fechaHasta inválida (YYYY-MM-DD)' });
      }
    }

    // Obtener disponibilidad
    const slots = await obtenerDisponibilidad(recursoId, desde, hasta);

    res.json({
      recursoId,
      slots,
      total: slots.length,
    });
  } catch (error) {
    console.error('Error en GET /disponibilidad/:recursoId:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /disponibilidad/:recursoId/validar
 * 
 * Valida si un slot específico sigue siendo disponible
 * 
 * Body:
 * {
 *   fecha: "2026-08-10",
 *   hora: "10:30",
 *   profesionalId: "prof-123" (opcional, si es recurso genérico)
 * }
 */
router.post('/:recursoId/validar', requireAuth, async (req, res) => {
  try {
    const { recursoId } = req.params;
    const { fecha, hora, profesionalId } = req.body;

    if (!fecha || !hora) {
      return res.status(400).json({ error: 'Falta fecha o hora' });
    }

    const valido = await validarSlot(recursoId, fecha, hora, profesionalId);

    res.json({
      recursoId,
      fecha,
      hora,
      valido,
    });
  } catch (error) {
    console.error('Error en POST /disponibilidad/:recursoId/validar:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;