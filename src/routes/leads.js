/**
 * src/routes/leads.js
 *
 * Pool unificado de leads para el panel de vendedores — capa sobre
 * DemoAsignada (WhatsApp) y sobre fuentes externas (hoy: app de captura de
 * emails, proyecto aparte). Ver modelo Lead en prisma/schema.prisma.
 *
 * POST /leads es el puente: lo llama la app de captura de emails, no un
 * usuario logueado del panel — se autentica con un API key compartido
 * (X-Api-Key contra LEADS_BRIDGE_API_KEY), no con el JWT de vendedor/negocio.
 *
 * GET /leads/pool y POST /leads/pool/:id/asignar reemplazan a los antiguos
 * GET /demos/pool y POST /demos/pool/:id/tomar (que leían DemoAsignada
 * directo) — ahora leen/escriben sobre Lead, que unifica ambos orígenes.
 * La distribución es manual y centralizada en el admin (rolVendedor: 'ADMIN'),
 * no autoservicio de cualquier vendedor — por eso no existe un /tomar acá:
 * un endpoint así, aunque el panel no lo llame, seguiría siendo alcanzable
 * por cualquier vendedor con acceso directo a la API, saltándose el control
 * que se pidió explícitamente.
 */

const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');
const {
  MOTIVO_ASIGNACION_MANUAL,
  asignarLeadAVendedor,
  distribuirLeadNuevo,
} = require('../services/distribucionLeadsService');

const router = express.Router();

const ORIGENES_VALIDOS = ['whatsapp_demo', 'email_campana'];
const TURNOS_HISTORIAL_EN_POOL = 6;

// El nivel de interés de email nunca baja — si el puente manda un nivel
// menor al ya guardado (ej. llega "clic" después de que ya se había
// registrado "respuesta"), se ignora ese campo puntual sin tocar el resto
// del payload.
const JERARQUIA_NIVEL_INTERES_EMAIL = { clic: 1, formulario: 2, respuesta: 3 };

// Comparación en tiempo constante, mismo criterio que la verificación de
// firma del webhook de WhatsApp en server.js — evita timing attacks contra
// el API key.
function apiKeyValida(recibida, esperada) {
  if (!recibida || !esperada) return false;
  const bufRecibida = Buffer.from(recibida);
  const bufEsperada = Buffer.from(esperada);
  return bufRecibida.length === bufEsperada.length && crypto.timingSafeEqual(bufRecibida, bufEsperada);
}

function requireLeadsBridgeApiKey(req, res, next) {
  const esperada = process.env.LEADS_BRIDGE_API_KEY;
  if (!esperada) {
    console.error('[LEADS] LEADS_BRIDGE_API_KEY no está configurada — rechazando por seguridad.');
    return res.status(401).json({ error: 'No autorizado' });
  }

  const recibida = req.header('x-api-key');
  if (!apiKeyValida(recibida, esperada)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}

// ------------------------------------------------------------
// POST /leads — puente para la app de captura de emails (u otras fuentes
// externas futuras). Upsert por origen+origenId: si ya existe un Lead para
// ese origen, lo actualiza en vez de duplicarlo.
// ------------------------------------------------------------
router.post('/', requireLeadsBridgeApiKey, async (req, res) => {
  try {
    const {
      origen,
      origenId,
      telefono,
      email,
      nombreProspecto,
      rubro,
      intencionDetectada,
      ultimoMensajeResumen,
      ultimaInteraccionEn,
      motivoDerivacion,
      nivelInteresEmail,
    } = req.body;

    if (!ORIGENES_VALIDOS.includes(origen)) {
      return res.status(400).json({ error: `origen debe ser uno de: ${ORIGENES_VALIDOS.join(', ')}` });
    }
    if (!origenId) {
      return res.status(400).json({ error: 'Falta origenId' });
    }
    if (!telefono && !email) {
      return res.status(400).json({ error: 'Falta telefono o email (al menos uno es obligatorio)' });
    }
    if (nivelInteresEmail != null && !JERARQUIA_NIVEL_INTERES_EMAIL[nivelInteresEmail]) {
      return res.status(400).json({ error: `nivelInteresEmail debe ser uno de: ${Object.keys(JERARQUIA_NIVEL_INTERES_EMAIL).join(', ')}` });
    }

    const datos = {
      telefono: telefono || null,
      email: email || null,
      nombreProspecto: nombreProspecto || null,
      rubro: rubro || null,
      intencionDetectada: Boolean(intencionDetectada),
      ultimoMensajeResumen: ultimoMensajeResumen || null,
      ultimaInteraccionEn: ultimaInteraccionEn ? new Date(ultimaInteraccionEn) : null,
      motivoDerivacion: motivoDerivacion || null,
    };

    const leadExistente = await prisma.lead.findUnique({
      where: { origen_origenId: { origen, origenId } },
      select: { nivelInteresEmail: true },
    });
    const esLeadNuevo = !leadExistente;

    if (nivelInteresEmail) {
      const nivelPrevio = leadExistente?.nivelInteresEmail;
      const noBaja = !nivelPrevio || JERARQUIA_NIVEL_INTERES_EMAIL[nivelInteresEmail] > JERARQUIA_NIVEL_INTERES_EMAIL[nivelPrevio];
      if (noBaja) {
        datos.nivelInteresEmail = nivelInteresEmail;
        datos.ultimoEventoEmailEn = new Date();
      }
    }

    const lead = await prisma.lead.upsert({
      where: { origen_origenId: { origen, origenId } },
      create: { origen, origenId, ...datos },
      update: datos,
    });

    // Distribución automática: solo tiene sentido en la creación — un Lead
    // que ya existía puede estar asignado o gestionado, no hay que tocarlo
    // solo porque el puente mandó una actualización de interacción.
    if (esLeadNuevo && lead.estado === 'sin_asignar') {
      distribuirLeadNuevo(lead.id).catch((err) => {
        console.error(`[LEADS] Error en distribución automática del lead ${lead.id}:`, err);
      });
    }

    res.status(201).json({ lead });
  } catch (error) {
    console.error('Error creando/actualizando Lead vía puente:', error);
    res.status(500).json({ error: 'Error al procesar el lead' });
  }
});

// ------------------------------------------------------------
// GET /leads/pool — leads sin asignar. Reemplaza a GET /demos/pool. Solo
// Vendedor ADMIN: la distribución es manual desde el panel de
// administración, no autoservicio de cualquier vendedor (decisión explícita
// del usuario — ver POST /pool/:id/asignar más abajo). ?origen= filtra por
// 'whatsapp_demo' | 'email_campana' — usado por las pantallas "Leads fonos"
// y "Leads emails" del panel, que muestran cada origen por separado.
// ------------------------------------------------------------
router.get('/pool', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { origen } = req.query;
    if (origen && !ORIGENES_VALIDOS.includes(origen)) {
      return res.status(400).json({ error: `origen debe ser uno de: ${ORIGENES_VALIDOS.join(', ')}` });
    }

    const leads = await prisma.lead.findMany({
      where: { estado: 'sin_asignar', ...(origen ? { origen } : {}) },
      orderBy: { ultimaInteraccionEn: 'desc' },
    });

    // El historial completo de la conversación vive en DemoAsignada, no en
    // Lead (ver leadSync.js) — para que el vendedor tenga contexto antes de
    // tomar el lead, se van a buscar acá los últimos N turnos, solo para los
    // leads de origen whatsapp_demo (email_campana no tiene equivalente).
    const idsDemo = leads.filter((l) => l.origen === 'whatsapp_demo').map((l) => l.origenId);
    const demos = idsDemo.length
      ? await prisma.demoAsignada.findMany({
          where: { id: { in: idsDemo } },
          select: { id: true, historialSimulacion: true },
        })
      : [];
    const historialPorDemoId = new Map(demos.map((d) => [d.id, d.historialSimulacion]));

    const leadsConHistorial = leads.map((lead) => {
      const historial = historialPorDemoId.get(lead.origenId);
      return {
        ...lead,
        ultimosTurnos: Array.isArray(historial) ? historial.slice(-TURNOS_HISTORIAL_EN_POOL) : [],
      };
    });

    res.json({ leads: leadsConHistorial });
  } catch (error) {
    console.error('Error listando el pool de leads:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// POST /leads/pool/:id/asignar — el admin distribuye manualmente un lead del
// pool a un vendedor específico. El where con estado: 'sin_asignar' hace que,
// si el admin hace doble clic o dos pestañas quedaron abiertas, solo la
// primera asignación se aplique (la segunda recibe 409).
// ------------------------------------------------------------
router.post('/pool/:id/asignar', requireAuth, requireRolVendedorAdmin, async (req, res) => {
  try {
    const { vendedorId } = req.body;
    if (!vendedorId) {
      return res.status(400).json({ error: 'Falta vendedorId' });
    }

    const vendedor = await prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { activo: true } });
    if (!vendedor || !vendedor.activo) {
      return res.status(400).json({ error: 'El vendedor elegido no existe o está bloqueado' });
    }

    // Marca 'asignado_manual_admin' a propósito (no la automática): un
    // traspaso a mano significa que el caso pesa más, y listarLeadsConSLA lo
    // usa para mostrarlo al inicio de "Mis Casos" mientras siga sin gestionar.
    const resultado = await asignarLeadAVendedor(req.params.id, vendedorId, MOTIVO_ASIGNACION_MANUAL);

    if (!resultado.ok) {
      return res.status(409).json({
        error: 'Este lead ya no está disponible en el pool (puede que ya se haya asignado).',
      });
    }

    res.json({
      ok: true,
      // Solo relevante para email_campana — permite al panel avisar si el
      // caso de trabajo no se pudo precargar solo (sin teléfono válido o
      // error de creación) y hace falta completarlo a mano.
      demoCreadaId: resultado.demoCreadaId,
      requiereCasoManual: resultado.requiereCasoManual,
    });
  } catch (error) {
    console.error('Error asignando lead del pool:', error);
    res.status(500).json({ error: 'Error al asignar el lead' });
  }
});

module.exports = router;
