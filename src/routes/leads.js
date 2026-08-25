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
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');

const router = express.Router();

const ORIGENES_VALIDOS = ['whatsapp_demo', 'email_campana'];
const TURNOS_HISTORIAL_EN_POOL = 6;

// Lead.rubro trae formas distintas según origen: para whatsapp_demo es el
// nombre de RubroTemplate (ej. "Óptica"); para email_campana, según el
// puente de multidigital-captura-emails, puede ser una clave real (ej.
// "optica") o el texto libre viejo de una campaña sin catálogo. Se intenta
// clave exacta primero, después nombre insensible a mayúsculas, y si nada
// matchea se usa el rubro catch-all "otro" del catálogo — nunca se bloquea
// la creación del caso por esto.
async function resolverRubroTemplate(rubroTexto) {
  if (rubroTexto) {
    const porClave = await prisma.rubroTemplate.findUnique({ where: { clave: rubroTexto } });
    if (porClave) return porClave;

    const porNombre = await prisma.rubroTemplate.findFirst({
      where: { nombre: { equals: rubroTexto, mode: 'insensitive' } },
    });
    if (porNombre) return porNombre;
  }
  return prisma.rubroTemplate.findUnique({ where: { clave: 'otro' } });
}

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

    if (nivelInteresEmail) {
      const leadExistente = await prisma.lead.findUnique({
        where: { origen_origenId: { origen, origenId } },
        select: { nivelInteresEmail: true },
      });
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

    const resultado = await prisma.lead.updateMany({
      where: { id: req.params.id, estado: 'sin_asignar' },
      data: { vendedorId, estado: 'asignado' },
    });

    if (resultado.count === 0) {
      return res.status(409).json({
        error: 'Este lead ya no está disponible en el pool (puede que ya se haya asignado).',
      });
    }

    // El Lead es la capa unificada del pool, pero "Mis casos" del vendedor
    // (GET /demos/prospectos, ver listarLeadsConSLA en slaService.js) lee
    // directo de DemoAsignada.vendedorId, no de Lead — sin este paso, asignar
    // acá no tenía ningún efecto visible para el vendedor. derivadoAVendedor:
    // true además evita que seguimientoDemo.js siga tratando esta demo como
    // sin derivar y le siga mandando seguimientos automáticos por su cuenta.
    // origenCaso: 'heredado' en ambas ramas — es la marca de trazabilidad
    // para el reporte de bonos (ver POST /demos/convertir-a-cliente-real,
    // que la copia a Empresa cuando el caso se convierte).
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    let demoCreadaId = null;
    if (lead?.origen === 'whatsapp_demo') {
      await prisma.demoAsignada.update({
        where: { id: lead.origenId },
        data: {
          vendedorId,
          derivadoAVendedor: true,
          derivadoEn: new Date(),
          motivoDerivacion: 'asignado_manual_admin',
          origenCaso: 'heredado',
        },
      });
    } else if (lead?.origen === 'email_campana') {
      // A diferencia de whatsapp_demo, acá no existe todavía ninguna
      // DemoAsignada — el Lead nació directo de un NegocioProspecto externo
      // (multidigital-captura-emails). Se crea acá mismo, con el mismo
      // patrón que POST /demos/prospectos, para que el lead "precargue" como
      // caso de trabajo real en Mis Casos en vez de quedar invisible.
      const numeroParseado = lead.telefono ? parsePhoneNumberFromString(lead.telefono, 'CL') : null;
      const telefonoNormalizado = numeroParseado?.isValid() ? numeroParseado.number.replace('+', '') : null;

      if (!telefonoNormalizado) {
        console.warn(`[LEADS] Lead ${lead.id} (email_campana) asignado sin teléfono válido — no se pudo crear la DemoAsignada automáticamente. telefono="${lead.telefono}"`);
      } else {
        const rubroTemplate = await resolverRubroTemplate(lead.rubro);
        try {
          const demoCreada = await prisma.$transaction(async (tx) => {
            const empresaDemo = await tx.empresa.create({
              data: { nombre: lead.nombreProspecto || 'Prospecto de campaña de email', rubroTemplateId: rubroTemplate.id, esDemo: true },
            });
            return tx.demoAsignada.create({
              data: {
                telefono: telefonoNormalizado,
                empresaDemoId: empresaDemo.id,
                nombreProspecto: lead.nombreProspecto,
                email: lead.email,
                vendedorId,
                origenDemo: 'email_campana',
                origenCaso: 'heredado',
                leadOrigenId: lead.id,
                derivadoAVendedor: true,
                derivadoEn: new Date(),
                motivoDerivacion: 'asignado_manual_admin',
              },
            });
          });
          demoCreadaId = demoCreada.id;
        } catch (errCreacion) {
          // Conflicto típico: ya existe una DemoAsignada con ese teléfono
          // (P2002) — no se bloquea la asignación del Lead por esto, sólo se
          // deja registrado para revisión manual.
          console.error(`[LEADS] Error creando DemoAsignada automática para lead ${lead.id}:`, errCreacion.message);
        }
      }
    }

    res.json({
      ok: true,
      // Solo relevante para email_campana — permite al panel avisar si el
      // caso de trabajo no se pudo precargar solo (sin teléfono válido o
      // error de creación) y hace falta completarlo a mano.
      demoCreadaId,
      requiereCasoManual: lead?.origen === 'email_campana' && !demoCreadaId,
    });
  } catch (error) {
    console.error('Error asignando lead del pool:', error);
    res.status(500).json({ error: 'Error al asignar el lead' });
  }
});

module.exports = router;
