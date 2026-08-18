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
 * GET /leads/pool y POST /leads/pool/:id/tomar reemplazan a los antiguos
 * GET /demos/pool y POST /demos/pool/:id/tomar (que leían DemoAsignada
 * directo) — ahora leen/escriben sobre Lead, que unifica ambos orígenes.
 */

const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const ORIGENES_VALIDOS = ['whatsapp_demo', 'email_campana'];

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

    const lead = await prisma.lead.upsert({
      where: { origen_origenId: { origen, origenId } },
      create: { origen, origenId, ...datos },
      update: datos,
    });

    res.status(201).json({ lead });
  } catch (error) {
    console.error('Error creando/actualizando Lead vía puente:', error);
    res.status(500).json({ error: 'Error al procesar el lead' });
  }
});

// ------------------------------------------------------------
// GET /leads/pool — leads sin asignar, de cualquier origen. Reemplaza a
// GET /demos/pool.
// ------------------------------------------------------------
router.get('/pool', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      where: { estado: 'sin_asignar' },
      orderBy: { ultimaInteraccionEn: 'desc' },
    });

    res.json({ leads });
  } catch (error) {
    console.error('Error listando el pool de leads:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// POST /leads/pool/:id/tomar — un vendedor se autoasigna un lead del pool.
// El where con estado: 'sin_asignar' hace que, si dos vendedores lo intentan
// casi al mismo tiempo, solo el primero lo tome (el segundo recibe 409).
// Reemplaza a POST /demos/pool/:id/tomar.
// ------------------------------------------------------------
router.post('/pool/:id/tomar', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const resultado = await prisma.lead.updateMany({
      where: { id: req.params.id, estado: 'sin_asignar' },
      data: { vendedorId: req.usuario.vendedorId, estado: 'asignado' },
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
