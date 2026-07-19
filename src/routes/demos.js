const express = require('express');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraerInfoSitioWeb } = require('../services/extraccionSitioWeb');

const router = express.Router();

const CLAVE_RUBRO_POR_OPCION = {
  OPTICA: 'optica',
  ESTETICA: 'centro_estetico',
  SALUD: 'salud_independiente',
  MANTENCION: 'mantencion_tecnica',
  PROACTIVO: 'catalogo_rotativo',
  OTRO: 'otro',
};

/**
 * Normaliza un teléfono al formato E.164 sin '+' que usa WhatsApp
 * (ej. "56912345678"). Requiere el código de país ISO (CL, MX, AR, PE,
 * CO, ES) para interpretar correctamente números en formato local, sin
 * que el vendedor tenga que escribir el código de país a mano.
 * Devuelve null si el número no es válido para ese país.
 */
function normalizarTelefono(numeroIngresado, paisIso) {
  const numero = parsePhoneNumberFromString(numeroIngresado, paisIso);
  if (!numero || !numero.isValid()) {
    return null;
  }
  return numero.number.replace('+', '');
}

// ------------------------------------------------------------
// POST /demos/prospectos
// body: { nombreNegocio, telefono, paisTelefono, nombreEncargado, rubro, sitioWeb? }
// ------------------------------------------------------------
router.post('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const { nombreNegocio, telefono, paisTelefono, nombreEncargado, rubro, sitioWeb } = req.body;

    if (!nombreNegocio || !telefono || !paisTelefono || !nombreEncargado || !rubro) {
      return res.status(400).json({
        error: 'Faltan campos: nombreNegocio, telefono, paisTelefono, nombreEncargado, rubro',
      });
    }

    const telefonoNormalizado = normalizarTelefono(telefono, paisTelefono);
    if (!telefonoNormalizado) {
      return res.status(400).json({ error: 'El teléfono ingresado no es válido para el país seleccionado' });
    }

    const claveRubro = CLAVE_RUBRO_POR_OPCION[rubro];
    if (!claveRubro) {
      return res.status(400).json({ error: `Rubro inválido: ${rubro}` });
    }

    const rubroTemplate = await prisma.rubroTemplate.findUnique({ where: { clave: claveRubro } });
    if (!rubroTemplate) {
      return res.status(500).json({ error: `No existe RubroTemplate con clave "${claveRubro}"` });
    }

    const demoExistente = await prisma.demoAsignada.findUnique({ where: { telefono: telefonoNormalizado } });

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
        where: { telefono: telefonoNormalizado },
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
          telefono: telefonoNormalizado,
          empresaDemoId: empresaDemo.id,
          nombreProspecto: nombreEncargado,
          vendedorId: req.usuario.vendedorId,
        },
      });
    }

    res.json({
      ok: true,
      empresaDemoId: empresaDemo.id,
      telefonoNormalizado,
      infoExtraida: infoExtraida?.exito ? infoExtraida : null,
      mensaje: demoExistente ? 'Demo actualizada' : 'Demo creada',
    });
  } catch (error) {
    console.error('Error creando prospecto de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// GET /demos/prospectos
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