/**
 * src/routes/adminVendedores.js
 *
 * Rutas admin-only del Panel de Vendedores (rolVendedor: 'ADMIN'):
 * activación manual de pago, configuración de ranking y de SLA/aging.
 */

const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// POST /admin-vendedores/suscripciones/:empresaId/marcar-activa
// El pipeline real de cobro (Flow.cl) está roto y fuera de alcance de esta
// fase — mientras se coordina el cobro fuera del sistema (transferencia,
// efectivo, etc.), un admin marca la Suscripcion como ACTIVA a mano. Este es
// el evento que consume el ranking de conversión. Queda listo para que un
// webhook real dispare lo mismo sin cambiar el modelo de datos.
// ------------------------------------------------------------
router.post('/suscripciones/:empresaId/marcar-activa', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { empresaId } = req.params;

    const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });
    if (!suscripcion) {
      return res.status(404).json({ error: 'Esta empresa no tiene una suscripción (todavía no eligió un plan)' });
    }
    if (suscripcion.estado === 'ACTIVA') {
      return res.status(400).json({ error: 'Esta suscripción ya está activa' });
    }

    const actualizada = await prisma.suscripcion.update({
      where: { empresaId },
      data: { estado: 'ACTIVA', fechaActivacion: new Date() },
    });

    res.json({ ok: true, suscripcion: actualizada });
  } catch (error) {
    console.error('Error marcando suscripción como activa:', error);
    res.status(500).json({ error: 'Error al marcar la suscripción como activa' });
  }
});

// ------------------------------------------------------------
// GET /admin-vendedores/suscripciones/pendientes
// Lista empresas con Suscripcion en PENDIENTE_PAGO (vino de un vendedor,
// esperando que el admin confirme el cobro y la marque activa).
// ------------------------------------------------------------
router.get('/suscripciones/pendientes', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const pendientes = await prisma.suscripcion.findMany({
      where: { estado: 'PENDIENTE_PAGO' },
      include: { empresa: { select: { id: true, nombre: true, telefonoContacto: true, vendedor: { select: { nombre: true } } } } },
      orderBy: { fechaInicio: 'desc' },
    });

    res.json({
      pendientes: pendientes.map((s) => ({
        empresaId: s.empresaId,
        empresaNombre: s.empresa.nombre,
        telefonoContacto: s.empresa.telefonoContacto,
        vendedorNombre: s.empresa.vendedor?.nombre || null,
        plan: s.plan,
        montoMensualActual: s.montoMensualActual,
        fechaInicio: s.fechaInicio,
      })),
    });
  } catch (error) {
    console.error('Error listando suscripciones pendientes:', error);
    res.status(500).json({ error: 'Error al listar suscripciones pendientes' });
  }
});

// ------------------------------------------------------------
// GET /admin-vendedores/ranking/config — premios por posición, meta grupal
// mensual y jerarquía de planes para el desempate.
// ------------------------------------------------------------
router.get('/ranking/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const [premios, meta, jerarquiaPlanes] = await Promise.all([
      prisma.configuracionPremio.findMany({ orderBy: { posicion: 'asc' } }),
      prisma.configuracionRankingGlobal.findFirst(),
      prisma.jerarquiaPlanDesempate.findMany({ orderBy: { orden: 'asc' } }),
    ]);

    res.json({
      premios,
      metaMinimaGrupalMensual: meta?.metaMinimaGrupalMensual ?? null,
      jerarquiaPlanes,
    });
  } catch (error) {
    console.error('Error obteniendo configuración de ranking:', error);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
});

// ------------------------------------------------------------
// POST /admin-vendedores/ranking/config
// body: { premios?: [{posicion, descripcion, monto}], metaMinimaGrupalMensual?: number, jerarquiaPlanes?: [{plan, orden}] }
// Todos los campos son opcionales — solo se actualiza lo que venga.
// ------------------------------------------------------------
router.post('/ranking/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { premios, metaMinimaGrupalMensual, jerarquiaPlanes } = req.body;

    if (Array.isArray(premios)) {
      for (const p of premios) {
        if (!Number.isInteger(p.posicion) || p.posicion < 1 || p.posicion > 5) continue;
        await prisma.configuracionPremio.upsert({
          where: { posicion: p.posicion },
          update: { descripcion: p.descripcion, monto: p.monto ?? null },
          create: { posicion: p.posicion, descripcion: p.descripcion, monto: p.monto ?? null },
        });
      }
    }

    if (typeof metaMinimaGrupalMensual === 'number' && metaMinimaGrupalMensual >= 0) {
      const existente = await prisma.configuracionRankingGlobal.findFirst();
      if (existente) {
        await prisma.configuracionRankingGlobal.update({
          where: { id: existente.id },
          data: { metaMinimaGrupalMensual },
        });
      } else {
        await prisma.configuracionRankingGlobal.create({ data: { metaMinimaGrupalMensual } });
      }
    }

    if (Array.isArray(jerarquiaPlanes)) {
      for (const j of jerarquiaPlanes) {
        if (!j.plan || typeof j.orden !== 'number') continue;
        await prisma.jerarquiaPlanDesempate.upsert({
          where: { plan: j.plan },
          update: { orden: j.orden },
          create: { plan: j.plan, orden: j.orden },
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error guardando configuración de ranking:', error);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

// ------------------------------------------------------------
// GET /admin-vendedores/sla/config — umbrales de SLA/aging por tipo de lead
// ------------------------------------------------------------
router.get('/sla/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const config = await prisma.configuracionSLA.findMany();
    res.json({ config });
  } catch (error) {
    console.error('Error obteniendo configuración de SLA:', error);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
});

// ------------------------------------------------------------
// POST /admin-vendedores/sla/config
// body: { config: [{tipoLead, diasPrimerContactoAmarillo, diasPrimerContactoRojo, diasAgingAmarillo, diasAgingRojo}] }
// ------------------------------------------------------------
router.post('/sla/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { config } = req.body;
    if (!Array.isArray(config)) {
      return res.status(400).json({ error: 'Falta config' });
    }

    for (const c of config) {
      if (!['CALIENTE', 'FRIO'].includes(c.tipoLead)) continue;
      const datos = {
        diasPrimerContactoAmarillo: c.diasPrimerContactoAmarillo,
        diasPrimerContactoRojo: c.diasPrimerContactoRojo,
        diasAgingAmarillo: c.diasAgingAmarillo,
        diasAgingRojo: c.diasAgingRojo,
      };
      await prisma.configuracionSLA.upsert({
        where: { tipoLead: c.tipoLead },
        update: datos,
        create: { tipoLead: c.tipoLead, ...datos },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error guardando configuración de SLA:', error);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

module.exports = router;
