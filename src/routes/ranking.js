/**
 * src/routes/ranking.js
 *
 * Ranking mensual de conversión — visible a cualquier vendedor autenticado
 * (todos ven el ranking completo entre sí, sin restricción de visibilidad).
 */
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// GET /ranking/actual — top 5 del mes en curso, leído de la cache que
// recalcula src/jobs/rankingCache.js cada 5 minutos.
// ------------------------------------------------------------
router.get('/actual', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const cache = await prisma.rankingCacheActual.findFirst();

    if (!cache) {
      return res.json({
        posiciones: [],
        totalConversionesEquipo: 0,
        metaMinimaGrupalMensual: 0,
        progresoMetaGrupal: 0,
        diasRestantesDelMes: null,
        actualizadoEn: null,
      });
    }

    res.json({ ...cache.dataJson, actualizadoEn: cache.actualizadoEn });
  } catch (error) {
    console.error('Error obteniendo ranking actual:', error);
    res.status(500).json({ error: 'Error al obtener el ranking' });
  }
});

// ------------------------------------------------------------
// GET /ranking/historial/:vendedorId — snapshots mensuales cerrados
// ------------------------------------------------------------
router.get('/historial/:vendedorId', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const historial = await prisma.rankingMensual.findMany({
      where: { vendedorId: req.params.vendedorId },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
    });

    res.json({ historial });
  } catch (error) {
    console.error('Error obteniendo historial de ranking:', error);
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

module.exports = router;
