/**
 * src/services/distribucionLeadsService.js
 *
 * Distribución automática del pool de leads (ver Lead en prisma/schema.prisma)
 * entre vendedores activos, con repoblamiento cuando un caso se cierra.
 *
 * Reglas de negocio (decididas 2026-08-30):
 * - En tiempo real: se intenta repartir apenas nace un Lead nuevo, y apenas se
 *   libera un cupo (un caso se convierte o se cierra por descarte).
 * - Criterio de elección: el vendedor ACTIVO con menos casos activos
 *   (DemoAsignada sin eliminar/convertir/cerrar) que aún no llegue al cupo.
 * - Si nadie tiene cupo libre, el lead queda "sin_asignar" en el pool — ahí
 *   sigue disponible el traspaso manual (POST /leads/pool/:id/asignar), que
 *   sí puede pasar por encima del cupo a propósito.
 * - Un traspaso manual marca motivoDerivacion: 'asignado_manual_admin' —
 *   listarLeadsConSLA (slaService.js) usa esa misma marca para mostrar el
 *   caso al inicio de "Mis Casos" mientras siga en fase de primer contacto
 *   (una vez gestionado una vez, vuelve al orden normal por SLA).
 * - Uno automático marca motivoDerivacion: 'asignado_automatico_cupo', para
 *   poder distinguir ambos caminos sin agregar un campo nuevo.
 */
const prisma = require('../lib/prisma');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const MOTIVO_ASIGNACION_MANUAL = 'asignado_manual_admin';
const MOTIVO_ASIGNACION_AUTOMATICA = 'asignado_automatico_cupo';

async function obtenerCupoMaximo() {
  const config = await prisma.configuracionDistribucionLeads.findFirst();
  return config?.cupoMaximoCasosActivos ?? 30;
}

// Rubro de un Lead de email_campana trae formas distintas según el puente de
// multidigital-captura-emails (clave real tipo "optica", o texto libre viejo
// de una campaña sin catálogo) — nunca bloquea la creación del caso por esto.
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

// Vendedores activos con menos casos activos que su cupo, ordenados de menor
// a mayor carga. Devuelve [] si nadie tiene cupo libre (o no hay vendedores).
async function listarVendedoresConCupoLibre() {
  const cupoMaximo = await obtenerCupoMaximo();

  const [vendedores, demosActivas] = await Promise.all([
    prisma.vendedor.findMany({ where: { activo: true }, select: { id: true } }),
    prisma.demoAsignada.groupBy({
      by: ['vendedorId'],
      where: { vendedorId: { not: null }, eliminadoEn: null, convertidaEn: null, cerradaEn: null },
      _count: true,
    }),
  ]);

  const casosPorVendedor = new Map(demosActivas.map((d) => [d.vendedorId, d._count]));

  return vendedores
    .map((v) => ({ vendedorId: v.id, casosActivos: casosPorVendedor.get(v.id) || 0 }))
    .filter((v) => v.casosActivos < cupoMaximo)
    .sort((a, b) => a.casosActivos - b.casosActivos);
}

// Elige un vendedor para un lead nuevo: el de menos casos activos, si alguno
// tiene cupo libre. null si nadie tiene espacio (el lead queda en el pool).
async function elegirVendedorParaNuevoLead() {
  const disponibles = await listarVendedoresConCupoLibre();
  return disponibles[0]?.vendedorId ?? null;
}

// Núcleo compartido por el traspaso manual (POST /leads/pool/:id/asignar) y
// la distribución automática — misma lógica de creación/actualización de
// DemoAsignada, solo cambia motivoDerivacion según quién llamó.
// Devuelve { ok, demoCreadaId, requiereCasoManual } — no lanza si el lead ya
// no está disponible (ok:false), para que el llamador decida qué hacer.
async function asignarLeadAVendedor(leadId, vendedorId, motivoDerivacion) {
  const resultado = await prisma.lead.updateMany({
    where: { id: leadId, estado: 'sin_asignar' },
    data: { vendedorId, estado: 'asignado' },
  });
  if (resultado.count === 0) {
    return { ok: false, demoCreadaId: null, requiereCasoManual: false };
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  let demoCreadaId = null;

  if (lead.origen === 'whatsapp_demo') {
    await prisma.demoAsignada.update({
      where: { id: lead.origenId },
      data: {
        vendedorId,
        derivadoAVendedor: true,
        derivadoEn: new Date(),
        motivoDerivacion,
        origenCaso: 'heredado',
      },
    });
  } else if (lead.origen === 'email_campana') {
    const numeroParseado = lead.telefono ? parsePhoneNumberFromString(lead.telefono, 'CL') : null;
    const telefonoNormalizado = numeroParseado?.isValid() ? numeroParseado.number.replace('+', '') : null;

    if (!telefonoNormalizado) {
      console.warn(`[DISTRIBUCION] Lead ${lead.id} (email_campana) asignado sin teléfono válido — no se pudo crear la DemoAsignada automáticamente. telefono="${lead.telefono}"`);
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
              motivoDerivacion,
            },
          });
        });
        demoCreadaId = demoCreada.id;
      } catch (errCreacion) {
        // Conflicto típico: ya existe una DemoAsignada con ese teléfono
        // (P2002) — no se revierte la asignación del Lead por esto, sólo
        // queda registrado para revisión manual.
        console.error(`[DISTRIBUCION] Error creando DemoAsignada automática para lead ${lead.id}:`, errCreacion.message);
      }
    }
  }

  return {
    ok: true,
    demoCreadaId,
    requiereCasoManual: lead.origen === 'email_campana' && !demoCreadaId,
  };
}

// Llamar justo después de crear un Lead nuevo (estado 'sin_asignar') — tanto
// desde el puente de email (routes/leads.js) como desde WhatsApp (leadSync.js).
// Si nadie tiene cupo libre, no hace nada: el lead queda en el pool para
// traspaso manual, tal como antes de que existiera la distribución automática.
async function distribuirLeadNuevo(leadId) {
  const vendedorId = await elegirVendedorParaNuevoLead();
  if (!vendedorId) return { asignado: false };

  const resultado = await asignarLeadAVendedor(leadId, vendedorId, MOTIVO_ASIGNACION_AUTOMATICA);
  return { asignado: resultado.ok, ...resultado };
}

// Llamar justo después de que un caso se cierre para un vendedor (conversión
// en POST /demos/convertir-a-cliente-real, o cierre por descarte en
// recomputarDerivadosDemo de gestionVenta.js). Si el vendedor sigue con cupo
// libre y hay algo esperando en el pool, le entra el lead más antiguo — el
// mismo criterio simple de "quién espera hace más tiempo" para todo el pool,
// sin distinguir origen ni temperatura del lead.
async function intentarRepoblarCupo(vendedorId) {
  if (!vendedorId) return { asignado: false };

  const [cupoMaximo, vendedor, casosActivos] = await Promise.all([
    obtenerCupoMaximo(),
    prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { activo: true } }),
    prisma.demoAsignada.count({
      where: { vendedorId, eliminadoEn: null, convertidaEn: null, cerradaEn: null },
    }),
  ]);

  if (!vendedor?.activo || casosActivos >= cupoMaximo) return { asignado: false };

  const siguienteLead = await prisma.lead.findFirst({
    where: { estado: 'sin_asignar' },
    orderBy: { creadoEn: 'asc' },
  });
  if (!siguienteLead) return { asignado: false };

  const resultado = await asignarLeadAVendedor(siguienteLead.id, vendedorId, MOTIVO_ASIGNACION_AUTOMATICA);
  return { asignado: resultado.ok, ...resultado };
}

module.exports = {
  MOTIVO_ASIGNACION_MANUAL,
  MOTIVO_ASIGNACION_AUTOMATICA,
  obtenerCupoMaximo,
  asignarLeadAVendedor,
  distribuirLeadNuevo,
  intentarRepoblarCupo,
};
