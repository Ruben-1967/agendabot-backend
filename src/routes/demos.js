/**
 * src/routes/demos.js
 *
 * Rutas para el flujo de demos comerciales del vendedor:
 * crear/actualizar un prospecto, listar sus demos, eliminarlas (soft-delete).
 *
 * El rubro se recibe como `claveRubro` (string libre, ej. "optica",
 * "belleza_estetica_bienestar") y se valida contra RubroTemplate en la
 * base de datos — no hay enum fijo en código. Agregar un rubro nuevo en
 * el futuro es solo un seed, sin tocar este archivo.
 */

const express = require('express');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraerInfoSitioWeb } = require('../services/extraccionSitioWeb');

const router = express.Router();

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

// Crea los Producto de una demo de catálogo rotativo. Usa el catálogo
// extraído del sitio web si vino algo útil; si no, cae al catálogo
// sugerido por defecto del rubro (RubroTemplate.serviciosBase, que para
// rubros CATALOGO_ROTATIVO tiene la misma forma {nombre, precio, descripcion}
// que productosSugeridos de extraccionSitioWeb.js — mismo contrato).
async function crearProductosDeCatalogo(empresaId, catalogo) {
  if (!Array.isArray(catalogo) || catalogo.length === 0) return 0;

  const datos = catalogo
    .filter((p) => p && p.nombre && Number.isFinite(Number(p.precio)))
    .map((p) => ({
      empresaId,
      nombre: p.nombre,
      precio: Math.round(Number(p.precio)),
      descripcion: p.descripcion || null,
    }));

  if (datos.length === 0) return 0;

  await prisma.producto.createMany({ data: datos });
  return datos.length;
}

// ------------------------------------------------------------
// GET /demos/rubros — lista los RubroTemplate disponibles, para armar
// el dropdown de "Nueva demo" en el panel del vendedor sin hardcodear
// opciones en el frontend. Agregar un rubro nuevo en el futuro es solo
// un seed en la base, sin tocar este archivo ni el frontend.
// ------------------------------------------------------------
router.get('/rubros', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const rubros = await prisma.rubroTemplate.findMany({
      select: { id: true, clave: true, nombre: true, modoOperacion: true },
      orderBy: { nombre: 'asc' },
    });

    res.json({ rubros });
  } catch (error) {
    console.error('Error listando rubros:', error);
    res.status(500).json({ error: 'Error al listar los rubros' });
  }
});

// ------------------------------------------------------------
// POST /demos/prospectos
// body: { nombreNegocio, telefono, paisTelefono, nombreEncargado, claveRubro, sitioWeb? }
// Crea (o actualiza, si el teléfono ya existía) la Empresa demo y su
// DemoAsignada. Si viene sitioWeb, intenta extraer información real
// antes de guardar. Para rubros CATALOGO_ROTATIVO, crea los Producto
// de la demo (del sitio extraído, o del catálogo por defecto del rubro).
// ------------------------------------------------------------
router.post('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const { nombreNegocio, telefono, paisTelefono, nombreEncargado, claveRubro, sitioWeb } = req.body;

    if (!nombreNegocio || !telefono || !paisTelefono || !nombreEncargado || !claveRubro) {
      return res.status(400).json({
        error: 'Faltan campos: nombreNegocio, telefono, paisTelefono, nombreEncargado, claveRubro',
      });
    }

    const telefonoNormalizado = normalizarTelefono(telefono, paisTelefono);
    if (!telefonoNormalizado) {
      return res.status(400).json({ error: 'El teléfono ingresado no es válido para el país seleccionado' });
    }

    const rubroTemplate = await prisma.rubroTemplate.findUnique({ where: { clave: claveRubro } });
    if (!rubroTemplate) {
      return res.status(400).json({ error: `Rubro inválido: ${claveRubro}` });
    }

    // Nota: como al eliminar una demo se "desocupa" el campo telefono (ver
    // ruta DELETE más abajo), este findUnique naturalmente no encuentra
    // demos eliminadas — el número real queda libre para asignarse de nuevo
    // sin conflicto con el registro histórico.
    const demoExistente = await prisma.demoAsignada.findUnique({ where: { telefono: telefonoNormalizado } });

    const sitioWebNormalizado = normalizarSitioWeb(sitioWeb);

    let infoExtraida = null;
    if (sitioWebNormalizado) {
      const esCatalogo = rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO';
      const rutas = esCatalogo ? RUTAS_CATALOGO_TIPICAS : undefined;
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
      // Limpiamos productos previos de esa empresa demo antes de recargar,
      // para no acumular catálogos viejos si el vendedor reconfigura la demo.
      await prisma.producto.deleteMany({ where: { empresaId: empresaDemo.id } });
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
          origenDemo: 'vendedor',
        },
      });
    }

    let productosCreados = 0;
    if (rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO') {
      const catalogoAUsar =
        infoExtraida?.exito && Array.isArray(infoExtraida.productosSugeridos) && infoExtraida.productosSugeridos.length > 0
          ? infoExtraida.productosSugeridos
          : rubroTemplate.serviciosBase; // catálogo por defecto del rubro, misma forma {nombre, precio, descripcion}

      productosCreados = await crearProductosDeCatalogo(empresaDemo.id, catalogoAUsar);
    }

    res.json({
      ok: true,
      empresaDemoId: empresaDemo.id,
      infoExtraida: infoExtraida?.exito ? infoExtraida : null,
      productosCreados,
      mensaje: demoExistente ? 'Demo actualizada' : 'Demo creada',
    });
  } catch (error) {
    console.error('Error creando prospecto de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// GET /demos/prospectos — lista las demos del vendedor autenticado
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// GET /demos/pool — leads derivados a vendedor por el seguimiento
// automático post-demo (ver src/jobs/seguimientoDemo.js): demos orgánicas
// que probaron la demo pero no se pudieron contactar dentro de la ventana
// de servicio de WhatsApp (24h). No hay reparto automático entre vendedores
// (eso es una fase aparte) — cualquier vendedor autenticado puede ver el
// pool y tomar un lead con POST /demos/pool/:id/tomar.
// ------------------------------------------------------------
router.get('/pool', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demos = await prisma.demoAsignada.findMany({
      where: { derivadoAVendedor: true, vendedorId: null, eliminadoEn: null },
      include: { empresaDemo: { include: { rubroTemplate: true } } },
      orderBy: { derivadoEn: 'desc' },
    });

    const resultado = demos.map((d) => ({
      id: d.id,
      telefono: d.telefono,
      nombreNegocio: d.empresaDemo.nombre,
      nombreEncargado: d.nombreProspecto,
      rubro: d.empresaDemo.rubroTemplate.nombre,
      intencionPrecioDetectada: d.intencionPrecioDetectada,
      ultimaInteraccionEn: d.ultimaInteraccionEn,
      derivadoEn: d.derivadoEn,
      motivoDerivacion: d.motivoDerivacion,
    }));

    res.json({ demos: resultado });
  } catch (error) {
    console.error('Error listando el pool de leads derivados:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// POST /demos/pool/:id/tomar — un vendedor se autoasigna un lead del pool.
// El where con vendedorId: null hace que, si dos vendedores lo intentan casi
// al mismo tiempo, solo el primero lo tome (el segundo recibe 409).
// ------------------------------------------------------------
router.post('/pool/:id/tomar', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const resultado = await prisma.demoAsignada.updateMany({
      where: { id: req.params.id, derivadoAVendedor: true, vendedorId: null, eliminadoEn: null },
      data: { vendedorId: req.usuario.vendedorId },
    });

    if (resultado.count === 0) {
      return res.status(409).json({
        error: 'Este lead ya no está disponible en el pool (puede que otro vendedor ya lo haya tomado).',
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error tomando lead del pool:', error);
    res.status(500).json({ error: 'Error al tomar el lead' });
  }
});

module.exports = router;
