const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraerInfoSitioWeb } = require('../services/extraccionSitioWeb');

const router = express.Router();

// Mapea la opción que el vendedor elige en el formulario a la "clave"
// real de RubroTemplate. AJUSTAR si las claves reales en la base son
// distintas a estas (confirmar con el seed de RubroTemplate).
const CLAVE_RUBRO_POR_OPCION = {
  OPTICA: 'optica',
  ESTETICA: 'centro_estetico',
  SALUD: 'salud_independiente',
  MANTENCION: 'mantencion_tecnica',
  PANADERIA: 'panaderia_gourmet',
  OTRO: 'otro',
};

// ------------------------------------------------------------
// POST /demos/prospectos
// body: { nombreNegocio, telefono, nombreEncargado, rubro, sitioWeb? }
// Crea (o actualiza, si el teléfono ya existía) la Empresa demo y su
// DemoAsignada. Si viene sitioWeb, intenta extraer información real
// antes de guardar.
// ------------------------------------------------------------
router.post('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const { nombreNegocio, telefono, nombreEncargado, rubro, sitioWeb } = req.body;

    if (!nombreNegocio || !telefono || !nombreEncargado || !rubro) {
      return res.status(400).json({ error: 'Faltan campos: nombreNegocio, telefono, nombreEncargado, rubro' });
    }

    const claveRubro = CLAVE_RUBRO_POR_OPCION[rubro];
    if (!claveRubro) {
      return res.status(400).json({ error: `Rubro inválido: ${rubro}` });
    }

    const rubroTemplate = await prisma.rubroTemplate.findUnique({ where: { clave: claveRubro } });
    if (!rubroTemplate) {
      return res.status(500).json({ error: `No existe RubroTemplate con clave "${claveRubro}"` });
    }

    // Si el teléfono ya estaba cargado, reutilizamos el registro (permite
    // que un vendedor reconfigure una demo existente) en vez de fallar.
    const demoExistente = await prisma.demoAsignada.findUnique({ where: { telefono } });

    let infoExtraida = null;
    if (sitioWeb) {
      infoExtraida = await extraerInfoSitioWeb(sitioWeb);
    }

    const datosEmpresa = {
      nombre: nombreNegocio,
      rubroTemplateId: rubroTemplate.id,
      esDemo: true,
      sitioWeb: sitioWeb || null,
      direccion: infoExtraida?.exito ? infoExtraida.direccion : null,
      informacionAdicional: infoExtraida?.exito ? infoExtraida.informacionAdicionalSugerida : null,
    };

    let empresaDemo;
    if (demoExistente) {
      empresaDemo = await prisma.empresa.update({
        where: { id: demoExistente.empresaDemoId },
        data: datosEmpresa,
      });
      await prisma.demoAsignada.update({
        where: { telefono },
        data: {
          nombreProspecto: nombreEncargado,
          vendedorId: req.usuario.vendedorId,
          paso: 0,
          historialSimulacion: [],
        },
      });
    } else {
      empresaDemo = await prisma.empresa.create({ data: datosEmpresa });
      await prisma.demoAsignada.create({
        data: {
          telefono,
          empresaDemoId: empresaDemo.id,
          nombreProspecto: nombreEncargado,
          vendedorId: req.usuario.vendedorId,
        },
      });
    }

    res.json({
      ok: true,
      empresaDemoId: empresaDemo.id,
      infoExtraida: infoExtraida?.exito ? infoExtraida : null,
      mensaje: demoExistente ? 'Demo actualizada' : 'Demo creada',
    });
  } catch (error) {
    console.error('Error creando prospecto de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// GET /demos/prospectos — lista los prospectos cargados por el
// vendedor autenticado, con estado "ya probó la demo".
// ------------------------------------------------------------
router.get('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demos = await prisma.demoAsignada.findMany({
      where: { vendedorId: req.usuario.vendedorId },
      include: { empresaDemo: { include: { rubroTemplate: true } } },
      orderBy: { creadoEn: 'desc' },
    });

    const resultado = demos.map((d) => {
      const historial = Array.isArray(d.historialSimulacion) ? d.historialSimulacion : [];
      const yaProbo = historial.length > 0;
      return {
        id: d.id,
        telefono: d.telefono,
        nombreNegocio: d.empresaDemo.nombre,
        nombreEncargado: d.nombreProspecto,
        rubro: d.empresaDemo.rubroTemplate.nombre,
        creadoEn: d.creadoEn,
        yaProbo,
        // Aproximado: el historial no guarda timestamp por mensaje todavía,
        // así que usamos la última actualización del registro completo
        // como referencia de "última actividad" cuando ya hubo contacto.
        ultimaActividadEn: yaProbo ? d.actualizadoEn : null,
      };
    });

    res.json({ demos: resultado });
  } catch (error) {
    console.error('Error listando prospectos de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;