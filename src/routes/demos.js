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

const RUTAS_CATALOGO_TIPICAS = ['/pedir', '/menu', '/productos', '/tienda', '/catalogo'];

function normalizarTelefono(numeroIngresado, paisIso) {
  const numero = parsePhoneNumberFromString(numeroIngresado, paisIso);
  if (!numero || !numero.isValid()) {
    return null;
  }
  return numero.number.replace('+', '');
}

// Acepta la URL en cualquier forma razonable que escriba un vendedor:
// "qroll.cl", "www.qroll.cl", "qroll.cl/" — y siempre devuelve una URL
// completa con protocolo, que es lo único que fetch() puede interpretar.
// Sin esto, "qroll.cl" a secas revienta con "Failed to parse URL".
function normalizarSitioWeb(url) {
  if (!url) return null;
  const limpio = url.trim();
  if (!limpio) return null;
  return /^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`;
}

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

    // Nota: como al eliminar una demo se "desocupa" el campo telefono (ver
    // ruta DELETE más abajo), este findUnique naturalmente no encuentra
    // demos eliminadas — el número real queda libre para asignarse de nuevo
    // sin conflicto con el registro histórico.
    const demoExistente = await prisma.demoAsignada.findUnique({ where: { telefono: telefonoNormalizado } });

    const sitioWebNormalizado = normalizarSitioWeb(sitioWeb);

    let infoExtraida = null;
    if (sitioWebNormalizado) {
      const rutas = claveRubro === 'catalogo_rotativo' ? RUTAS_CATALOGO_TIPICAS : undefined;
      infoExtraida = await extraerInfoSitioWeb(sitioWebNormalizado, rutas);
    }

    const datosEmpresa = {
      nombre: nombreNegocio,
      rubroTemplateId: rubroTemplate.id,
      esDemo: true,
      sitioWeb: sitioWebNormalizado,
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
          carritoDemoJson: [],
        },
      });
      await prisma.producto.deleteMany({ where: { empresaId: empresaDemo.id } });
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

    let productosCreados = 0;
    if (claveRubro === 'catalogo_rotativo' && infoExtraida?.exito && infoExtraida.productosSugeridos?.length > 0) {
      const productosValidos = infoExtraida.productosSugeridos.filter(
        (p) => p.nombre && Number.isFinite(p.precio) && p.precio > 0
      );
      if (productosValidos.length > 0) {
        await prisma.producto.createMany({
          data: productosValidos.map((p) => ({
            empresaId: empresaDemo.id,
            nombre: p.nombre,
            descripcion: p.descripcion || null,
            precio: Math.round(p.precio),
            activo: true,
          })),
        });
        productosCreados = productosValidos.length;
      }
    }

    res.json({
      ok: true,
      empresaDemoId: empresaDemo.id,
      telefonoNormalizado,
      infoExtraida: infoExtraida?.exito ? infoExtraida : null,
      productosCreados,
      mensaje: demoExistente ? 'Demo actualizada' : 'Demo creada',
    });
  } catch (error) {
    console.error('Error creando prospecto de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demos = await prisma.demoAsignada.findMany({
      where: { vendedorId: req.usuario.vendedorId, eliminadoEn: null },
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

// ------------------------------------------------------------
// DELETE /demos/prospectos/:id — el vendedor "elimina" una demo. En
// realidad es un soft-delete: se conserva la Empresa, el Producto, y todo
// el historial de la simulación (útil para métricas de conversión más
// adelante), pero el teléfono real queda libre de inmediato para una demo
// nueva. Se logra guardando el teléfono real en `telefonoOriginal` y
// reemplazando `telefono` por un valor único-pero-inofensivo, ya que ese
// campo tiene una restricción de unicidad en la base.
// ------------------------------------------------------------
router.delete('/prospectos/:id', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demo = await prisma.demoAsignada.findUnique({ where: { id: req.params.id } });

    if (!demo || demo.vendedorId !== req.usuario.vendedorId) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }
    if (demo.eliminadoEn) {
      return res.status(400).json({ error: 'Esta demo ya había sido eliminada' });
    }

    await prisma.demoAsignada.update({
      where: { id: demo.id },
      data: {
        telefonoOriginal: demo.telefonoOriginal || demo.telefono,
        telefono: `eliminado:${demo.id}`,
        eliminadoEn: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando (soft-delete) prospecto de demo:', error);
    res.status(500).json({ error: 'Error al eliminar la demo' });
  }
});

module.exports = router;