/**
 * src/routes/adminVendedores.js
 *
 * Rutas admin-only del Panel de Vendedores (rolVendedor: 'ADMIN'):
 * activación manual de pago, configuración de ranking y de SLA/aging.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');
const { resumenLeadsPorVendedor } = require('../services/slaService');
const { conversionesDelMesPorVendedor } = require('../services/rankingService');
const { obtenerCupoMaximo } = require('../services/distribucionLeadsService');

const router = express.Router();

// ------------------------------------------------------------
// GET /admin-vendedores/vendedores
// Listado de vendedores (incluye bloqueados, con su estado visible) para la
// vista admin "Vendedores".
// ------------------------------------------------------------
router.get('/vendedores', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const vendedores = await prisma.vendedor.findMany({
      select: {
        id: true, nombre: true, email: true, activo: true, rol: true, creadoEn: true,
        telefono: true, direccion: true, fechaIngreso: true,
      },
      orderBy: { nombre: 'asc' },
    });
    res.json({ vendedores });
  } catch (error) {
    console.error('Error listando vendedores:', error);
    res.status(500).json({ error: 'Error al listar los vendedores' });
  }
});

// ------------------------------------------------------------
// POST /admin-vendedores/vendedores
// body: { nombre, email, password, rol?, telefono?, direccion?, fechaIngreso? }
// mismo hash bcrypt que scripts/crear-vendedor.js (10 rounds).
// ------------------------------------------------------------
router.post('/vendedores', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono, direccion, fechaIngreso } = req.body;
    if (!nombre?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Faltan nombre, email o contraseña' });
    }
    if (rol && !['VENDEDOR', 'SUPERVISOR', 'ADMIN'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const emailNormalizado = email.toLowerCase().trim();
    const existente = await prisma.vendedor.findUnique({ where: { email: emailNormalizado } });
    if (existente) {
      return res.status(409).json({ error: 'Ya existe un vendedor con ese email' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const vendedor = await prisma.vendedor.create({
      data: {
        nombre: nombre.trim(),
        email: emailNormalizado,
        passwordHash,
        rol: rol || 'VENDEDOR',
        activo: true,
        telefono: telefono?.trim() || null,
        direccion: direccion?.trim() || null,
        fechaIngreso: fechaIngreso ? new Date(fechaIngreso) : null,
      },
      select: {
        id: true, nombre: true, email: true, activo: true, rol: true, creadoEn: true,
        telefono: true, direccion: true, fechaIngreso: true,
      },
    });

    res.status(201).json({ vendedor });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un vendedor con ese email' });
    }
    console.error('Error creando vendedor:', error);
    res.status(500).json({ error: 'Error al crear el vendedor' });
  }
});

// ------------------------------------------------------------
// PATCH /admin-vendedores/vendedores/:id/activo
// body: { activo: boolean } — toggle de bloqueo. No reasigna casos activos
// (queda como tarea manual aparte, a definir después).
// ------------------------------------------------------------
router.patch('/vendedores/:id/activo', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'Falta activo (boolean)' });
    }

    const vendedor = await prisma.vendedor.update({
      where: { id },
      data: { activo },
      select: { id: true, nombre: true, email: true, activo: true, rol: true, creadoEn: true },
    });

    res.json({ vendedor });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Vendedor no encontrado' });
    }
    console.error('Error actualizando estado del vendedor:', error);
    res.status(500).json({ error: 'Error al actualizar el vendedor' });
  }
});

// ------------------------------------------------------------
// PATCH /admin-vendedores/vendedores/:id/resetear-password
// body: { password }
// ------------------------------------------------------------
router.patch('/vendedores/:id/resetear-password', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const vendedor = await prisma.vendedor.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, nombre: true, email: true, activo: true, rol: true, creadoEn: true },
    });

    res.json({ vendedor });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Vendedor no encontrado' });
    }
    console.error('Error reseteando contraseña del vendedor:', error);
    res.status(500).json({ error: 'Error al resetear la contraseña' });
  }
});

// ------------------------------------------------------------
// PUT /admin-vendedores/vendedores/:id/horario-modalidad
// body: { horario: [{ diaSemana, modalidad }] } — reemplaza el horario
// vigente del vendedor para los días recibidos (hasta 7, uno por día de
// semana; días no incluidos quedan sin modalidad definida). Cierra
// (vigenteHasta: hoy) cualquier registro vigente anterior para esos días y
// crea las nuevas filas con vigenteDesde: hoy. No borra historial —
// mismo principio que AtencionClinica versionado.
// ------------------------------------------------------------
router.put('/vendedores/:id/horario-modalidad', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { horario } = req.body;
    if (!Array.isArray(horario) || horario.length === 0) {
      return res.status(400).json({ error: 'Falta horario (array)' });
    }
    for (const h of horario) {
      if (!Number.isInteger(h.diaSemana) || h.diaSemana < 0 || h.diaSemana > 6) {
        return res.status(400).json({ error: 'diaSemana inválido (debe ser 0-6)' });
      }
      if (!['presencial', 'teletrabajo'].includes(h.modalidad)) {
        return res.status(400).json({ error: 'modalidad inválida (debe ser presencial o teletrabajo)' });
      }
    }

    const vendedor = await prisma.vendedor.findUnique({ where: { id } });
    if (!vendedor) {
      return res.status(404).json({ error: 'Vendedor no encontrado' });
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const diasRecibidos = horario.map((h) => h.diaSemana);

    await prisma.$transaction([
      prisma.horarioModalidadVendedor.updateMany({
        where: { vendedorId: id, diaSemana: { in: diasRecibidos }, vigenteHasta: null },
        data: { vigenteHasta: hoy },
      }),
      prisma.horarioModalidadVendedor.createMany({
        data: horario.map((h) => ({
          vendedorId: id,
          diaSemana: h.diaSemana,
          modalidad: h.modalidad,
          vigenteDesde: hoy,
        })),
      }),
    ]);

    const horarioActual = await prisma.horarioModalidadVendedor.findMany({
      where: { vendedorId: id, vigenteHasta: null },
      orderBy: { diaSemana: 'asc' },
    });

    res.json({ horario: horarioActual });
  } catch (error) {
    console.error('Error actualizando horario de modalidad:', error);
    res.status(500).json({ error: 'Error al actualizar el horario de modalidad' });
  }
});

// ------------------------------------------------------------
// GET /admin-vendedores/vendedores-kpi
// Resumen por vendedor: casos activos por semáforo SLA + conversiones del
// mes en curso. Alimenta el selector de vendedor en "Mis casos" (admin).
// ------------------------------------------------------------
router.get('/vendedores-kpi', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const [resumenLeads, conversionesPorVendedor] = await Promise.all([
      resumenLeadsPorVendedor(),
      conversionesDelMesPorVendedor(),
    ]);

    const vendedores = resumenLeads.map((r) => ({
      ...r,
      conversionesMes: conversionesPorVendedor[r.vendedorId] || 0,
    }));

    res.json({ vendedores });
  } catch (error) {
    console.error('Error obteniendo KPIs por vendedor:', error);
    res.status(500).json({ error: 'Error al obtener los KPIs por vendedor' });
  }
});

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

    // Si venía de avisos/bloqueo por prueba vencida (ver
    // bloquearEmpresasVencidas.js), pagar la limpia por completo.
    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        bloqueadaPorPruebaVencida: false,
        avisosPruebaVencidaEnviados: 0,
        fechaUltimoAvisoPrueba: null,
        fechaBloqueoPrueba: null,
      },
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

    const hoy = new Date();
    res.json({
      pendientes: pendientes.map((s) => ({
        empresaId: s.empresaId,
        empresaNombre: s.empresa.nombre,
        telefonoContacto: s.empresa.telefonoContacto,
        vendedorNombre: s.empresa.vendedor?.nombre || null,
        plan: s.plan,
        montoMensualActual: s.montoMensualActual,
        fechaInicio: s.fechaInicio,
        diasSinPago: Math.floor((hoy - s.fechaInicio) / (1000 * 60 * 60 * 24)),
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

// ------------------------------------------------------------
// GET /admin-vendedores/distribucion/config — cupo máximo de casos activos
// por vendedor, usado por la distribución automática del pool de leads (ver
// src/services/distribucionLeadsService.js). Fila única (singleton).
// ------------------------------------------------------------
router.get('/distribucion/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const cupoMaximoCasosActivos = await obtenerCupoMaximo();
    res.json({ cupoMaximoCasosActivos });
  } catch (error) {
    console.error('Error obteniendo configuración de distribución:', error);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
});

// ------------------------------------------------------------
// POST /admin-vendedores/distribucion/config
// body: { cupoMaximoCasosActivos: number }
// ------------------------------------------------------------
router.post('/distribucion/config', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { cupoMaximoCasosActivos } = req.body;
    if (!Number.isInteger(cupoMaximoCasosActivos) || cupoMaximoCasosActivos < 1) {
      return res.status(400).json({ error: 'cupoMaximoCasosActivos debe ser un entero mayor a 0' });
    }

    const existente = await prisma.configuracionDistribucionLeads.findFirst();
    if (existente) {
      await prisma.configuracionDistribucionLeads.update({
        where: { id: existente.id },
        data: { cupoMaximoCasosActivos },
      });
    } else {
      await prisma.configuracionDistribucionLeads.create({ data: { cupoMaximoCasosActivos } });
    }

    res.json({ ok: true, cupoMaximoCasosActivos });
  } catch (error) {
    console.error('Error guardando configuración de distribución:', error);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

module.exports = router;
