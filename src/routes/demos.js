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
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extraerInfoSitioWeb } = require('../services/extraccionSitioWeb');
const { sendWhatsAppTextMessage } = require('../services/whatsapp');
const { listarLeadsConSLA } = require('../services/slaService');
const { conversionesEnRangoPorVendedor } = require('../services/rankingService');
const { horaChileAFechaUTC, hoyISOEnChile } = require('../lib/horaChile');

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
// GET /demos/prospectos — lista las demos del vendedor autenticado, como
// casos priorizados: ordenadas por urgencia de SLA/aging (rojo, luego
// amarillo, luego ok) por defecto, no por elección del vendedor. Incluye
// contadorVencidos para el badge de alerta, visible sin aplicar filtros.
// Filtros (?estadoSLA=ROJO|AMARILLO|OK, ?tipoLead=CALIENTE|FRIO) son una
// herramienta de exploración aparte, no la única forma de ver lo urgente.
//
// ?vendedorId=<id>|todos — solo tiene efecto si el que pide es rolVendedor
// ADMIN (un vendedor normal siempre ve lo suyo, aunque mande el parámetro).
// 'todos' u omitido = todos los vendedores; un id puntual filtra a ese.
// ------------------------------------------------------------
router.get('/prospectos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const esAdmin = req.usuario.rolVendedor === 'ADMIN';
    const vendedorIdParam = req.query.vendedorId;

    const vendedorIdFiltro = esAdmin
      ? (vendedorIdParam && vendedorIdParam !== 'todos' ? vendedorIdParam : null)
      : req.usuario.vendedorId;

    const { leads, contadorVencidos } = await listarLeadsConSLA(vendedorIdFiltro);

    const { estadoSLA, tipoLead } = req.query;
    const filtrados = leads.filter((l) => {
      if (estadoSLA && l.estadoSLA !== estadoSLA) return false;
      if (tipoLead && l.tipoLead !== tipoLead) return false;
      return true;
    });

    res.json({ demos: filtrados, contadorVencidos });
  } catch (error) {
    console.error('Error listando prospectos de demo:', error);
    res.status(500).json({ error: error.message });
  }
});

function sumarUnDiaISO(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// GET /demos/kpis-diarios?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedorId=<id>|todos
// Bloque de "actividad" en un rango de fecha libre (por defecto hoy, hora de
// Chile) — complementa la tarjeta de KPIs de estado actual (vendedores-kpi)
// sin reemplazarla. Mismo mecanismo de scoping por rol que GET /prospectos:
// un vendedor normal siempre ve lo suyo, aunque mande vendedorId.
// ------------------------------------------------------------
router.get('/kpis-diarios', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const esAdmin = req.usuario.rolVendedor === 'ADMIN';
    const vendedorIdParam = req.query.vendedorId;

    const vendedorIdFiltro = esAdmin
      ? (vendedorIdParam && vendedorIdParam !== 'todos' ? vendedorIdParam : null)
      : req.usuario.vendedorId;

    const hoy = hoyISOEnChile();
    const desde = req.query.desde || hoy;
    const hasta = req.query.hasta || hoy;

    const inicio = horaChileAFechaUTC(desde, '00:00');
    const finExclusivo = horaChileAFechaUTC(sumarUnDiaISO(hasta), '00:00');

    const filtroVendedor = vendedorIdFiltro ? { vendedorId: vendedorIdFiltro } : { vendedorId: { not: null } };

    // Demos eliminadas (soft-delete) quedan fuera del KPI de actividad — mismo
    // criterio que ya usa slaService.js para "Mis casos". El registro y su
    // historial siguen existiendo en la base, solo se ajusta qué cuenta acá.
    // conversionesEnRangoPorVendedor no se toca: cuenta Empresa+Suscripcion
    // directamente, no DemoAsignada, y una conversión real no debe
    // desaparecer porque la demo de origen se haya borrado después.
    const [demosCreadas, negociosQueProbaron, eventosDistintos, conversionesPorVendedor] = await Promise.all([
      prisma.demoAsignada.count({
        where: { creadoEn: { gte: inicio, lt: finExclusivo }, eliminadoEn: null, ...filtroVendedor },
      }),
      prisma.demoAsignada.count({
        where: { primerMensajeProspectoEn: { gte: inicio, lt: finExclusivo }, eliminadoEn: null, ...filtroVendedor },
      }),
      prisma.eventoGestionVenta.findMany({
        where: {
          creadoEn: { gte: inicio, lt: finExclusivo },
          demoAsignada: { eliminadoEn: null },
          ...(vendedorIdFiltro ? { vendedorId: vendedorIdFiltro } : {}),
        },
        select: { demoAsignadaId: true },
        distinct: ['demoAsignadaId'],
      }),
      conversionesEnRangoPorVendedor(inicio, finExclusivo),
    ]);

    const conversiones = vendedorIdFiltro
      ? (conversionesPorVendedor[vendedorIdFiltro] || 0)
      : Object.values(conversionesPorVendedor).reduce((suma, n) => suma + n, 0);

    res.json({
      desde,
      hasta,
      vendedorId: vendedorIdFiltro || 'todos',
      demosCreadas,
      negociosQueProbaron,
      negociosGestionados: eventosDistintos.length,
      conversiones,
    });
  } catch (error) {
    console.error('Error obteniendo KPIs de gestión diaria:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// POST /demos/prospectos/:id/marcar-contactado
// Versión mínima del árbol de gestión de ventas (arbol-gestion-ventas-DISENO.md):
// registra un EventoGestionVenta genérico y resetea el timer de aging. Cuando
// se active la navegación completa del árbol (fase aparte, menor prioridad),
// este botón único se reemplaza por la selección canal->resultado real, sin
// tocar el modelo de datos.
// ------------------------------------------------------------
router.post('/prospectos/:id/marcar-contactado', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demo = await prisma.demoAsignada.findUnique({ where: { id: req.params.id } });

    if (!demo || demo.vendedorId !== req.usuario.vendedorId || demo.eliminadoEn) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }

    const ahora = new Date();
    await prisma.$transaction([
      prisma.eventoGestionVenta.create({
        data: {
          demoAsignadaId: demo.id,
          vendedorId: req.usuario.vendedorId,
          canal: 'OTRO',
          resultado: 'contacto_registrado',
          reseteaTimer: true,
        },
      }),
      prisma.demoAsignada.update({
        where: { id: demo.id },
        data: {
          primerContactoVendedorEn: demo.primerContactoVendedorEn || ahora,
          ultimoContactoEfectivoEn: ahora,
        },
      }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error('Error marcando contacto:', error);
    res.status(500).json({ error: 'Error al marcar el contacto' });
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

   const esAdmin = req.usuario.rolVendedor === 'ADMIN';
    if (!demo || (!esAdmin && demo.vendedorId !== req.usuario.vendedorId)) {
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
// GET /demos/pool y POST /demos/pool/:id/tomar se movieron a
// GET /leads/pool y POST /leads/pool/:id/tomar (ver src/routes/leads.js) —
// ahora leen/escriben sobre el modelo Lead, que unifica leads de WhatsApp
// (esta demo) y de otras fuentes (ej. app de captura de emails), en vez de
// leer DemoAsignada directo.
// ------------------------------------------------------------

// ------------------------------------------------------------
// POST /demos/convertir-a-cliente-real
// body: { demoId }
// El vendedor confirma que una demo se convirtió en cliente real: crea la
// Empresa real (vendedorId + demoOrigenId para atribución del ranking) y un
// Usuario ADMIN con un password temporal inutilizable — el cliente define su
// propia contraseña vía el link de activación que se le envía por WhatsApp
// (el vendedor nunca conoce la contraseña real). No crea Suscripcion todavía:
// eso ocurre cuando el cliente elige un plan en /suscripcion/elegir-plan.
// ------------------------------------------------------------
router.post('/convertir-a-cliente-real', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const { demoId } = req.body;
    if (!demoId) {
      return res.status(400).json({ error: 'Falta demoId' });
    }

    const demo = await prisma.demoAsignada.findUnique({
      where: { id: demoId },
      include: { empresaDemo: true },
    });

    if (!demo || demo.vendedorId !== req.usuario.vendedorId || demo.eliminadoEn) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }
    if (demo.convertidaEn) {
      return res.status(400).json({ error: 'Esta demo ya fue convertida a cliente real' });
    }

    const tokenActivacion = crypto.randomBytes(24).toString('hex');
    const tokenActivacionExpira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    // Password inutilizable hasta que el cliente active su cuenta — nadie (ni el
    // vendedor) puede iniciar sesión con esto porque el valor real nunca se comparte.
    const passwordHashTemporal = await bcrypt.hash(crypto.randomUUID(), 10);

    const { empresaReal } = await prisma.$transaction(async (tx) => {
      const empresaReal = await tx.empresa.create({
        data: {
          nombre: demo.empresaDemo.nombre,
          rubroTemplateId: demo.empresaDemo.rubroTemplateId,
          telefonoContacto: demo.telefono,
          sitioWeb: demo.empresaDemo.sitioWeb,
          direccion: demo.empresaDemo.direccion,
          informacionAdicional: demo.empresaDemo.informacionAdicional,
          esDemo: false,
          vendedorId: req.usuario.vendedorId,
          demoOrigenId: demo.id,
        },
      });

      await tx.usuario.create({
        data: {
          empresaId: empresaReal.id,
          nombre: demo.nombreProspecto || demo.empresaDemo.nombre,
          // No hay infraestructura de correo en el sistema — el login es por
          // email+password, pero la activación/entrega es por WhatsApp, así que
          // este email es solo un identificador estable, no se usa para enviar nada.
          email: `${demo.telefono}@cliente.totemsystem.cl`,
          passwordHash: passwordHashTemporal,
          rol: 'ADMIN',
          tokenActivacion,
          tokenActivacionExpira,
        },
      });

      await tx.demoAsignada.update({
        where: { id: demo.id },
        data: { convertidaEn: new Date() },
      });

      return { empresaReal };
    });

    const linkActivacion = `${process.env.PANEL_FRONTEND_URL}/activar-cuenta?token=${tokenActivacion}`;

    // El envío es texto libre, que WhatsApp Business API solo permite dentro
    // de la ventana de 24h desde el último mensaje del prospecto al bot —
    // fuera de esa ventana, Meta lo rechaza (típicamente error 131047,
    // "re-engagement message") y haría falta una plantilla aprobada en su
    // lugar. Mientras tanto: si el envío automático falla por lo que sea, no
    // se traga el error — se avisa al vendedor y se le entrega el link para
    // que lo comparta a mano por su propio WhatsApp.
    let whatsappEnviado = false;
    let motivoFalloWhatsapp = null;
    try {
      const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
      const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
      if (phoneNumberId && accessToken) {
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: demo.telefono,
          text: `¡Gracias por confiar en nosotros! Para activar tu cuenta y elegir tu plan, define tu contraseña acá: ${linkActivacion}`,
          accessToken,
        });
        whatsappEnviado = true;
      } else {
        motivoFalloWhatsapp = 'Faltan las credenciales de WhatsApp de demos configuradas en el servidor.';
        console.warn('[convertir-a-cliente-real] Faltan DEMO_PHONE_NUMBER_ID/DEMO_WHATSAPP_ACCESS_TOKEN; no se envió el link. Link:', linkActivacion);
      }
    } catch (errWhatsapp) {
      // La Empresa/Usuario ya quedaron creados — no revertimos la conversión por
      // un fallo de envío.
      motivoFalloWhatsapp = errWhatsapp.message;
      console.error('[convertir-a-cliente-real] Error enviando WhatsApp de activación:', errWhatsapp.message);
    }

    res.json({
      ok: true,
      empresaId: empresaReal.id,
      whatsappEnviado,
      // Siempre se devuelve, aunque el envío automático haya reportado éxito:
      // que la API de Meta no tire error no garantiza que el mensaje se vea
      // reflejado en el chat del prospecto (ej. número sin un dispositivo con
      // WhatsApp real detrás), así que el vendedor siempre tiene el link a
      // mano como respaldo.
      linkActivacion,
      motivoFalloWhatsapp,
      mensaje: whatsappEnviado
        ? 'Cliente real creado. Se envió el link de activación por WhatsApp.'
        : 'Cliente real creado, pero el WhatsApp automático no se pudo enviar — compartile este link a mano.',
    });
  } catch (error) {
    console.error('Error convirtiendo demo a cliente real:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
