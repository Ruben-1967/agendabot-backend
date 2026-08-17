/**
 * src/services/slaService.js
 *
 * Control de casos por vendedor: prioriza leads (DemoAsignada) por urgencia
 * de SLA/aging en vez de dejar que el vendedor elija qué mirar.
 *
 * "Lead caliente" (probó el sistema / demo personalizada) vs "frío" se deriva
 * de DemoAsignada.origenDemo (campo ya existente, sin agregar uno nuevo):
 * 'organico' (escribió directo al WhatsApp de demos) y 'vendedor' (demo
 * armada a medida por el vendedor) = CALIENTE; 'carga_masiva' y 'legacy' = FRIO.
 *
 * Dos fases de SLA por lead:
 * - "primer contacto": mientras primerContactoVendedorEn es null, se cuenta
 *   desde DemoAsignada.creadoEn.
 * - "aging": una vez que hubo contacto, se cuenta desde
 *   ultimoContactoEfectivoEn (se resetea con cada EventoGestionVenta que
 *   tenga reseteaTimer = true).
 */
const prisma = require('../lib/prisma');

const ORIGENES_CALIENTES = ['organico', 'vendedor'];

const CONFIG_SLA_POR_DEFECTO = {
  CALIENTE: { diasPrimerContactoAmarillo: 2, diasPrimerContactoRojo: 3, diasAgingAmarillo: 5, diasAgingRojo: 8 },
  FRIO: { diasPrimerContactoAmarillo: 3, diasPrimerContactoRojo: 5, diasAgingAmarillo: 8, diasAgingRojo: 15 },
};

const RANGO_URGENCIA = { ROJO: 0, AMARILLO: 1, OK: 2 };

function derivarTipoLead(origenDemo) {
  return ORIGENES_CALIENTES.includes(origenDemo) ? 'CALIENTE' : 'FRIO';
}

function diasDesde(fecha, ahora) {
  return (ahora - new Date(fecha)) / (1000 * 60 * 60 * 24);
}

// Devuelve { tipoLead, fase, estadoSLA, diasEnEstado }
function calcularEstadoSLA(demo, configPorTipo, ahora = new Date()) {
  const tipoLead = derivarTipoLead(demo.origenDemo);
  const config = configPorTipo[tipoLead];

  if (!demo.primerContactoVendedorEn) {
    const dias = diasDesde(demo.creadoEn, ahora);
    let estadoSLA = 'OK';
    if (dias >= config.diasPrimerContactoRojo) estadoSLA = 'ROJO';
    else if (dias >= config.diasPrimerContactoAmarillo) estadoSLA = 'AMARILLO';
    return { tipoLead, fase: 'primer_contacto', estadoSLA, diasEnEstado: Math.floor(dias) };
  }

  const referencia = demo.ultimoContactoEfectivoEn || demo.primerContactoVendedorEn;
  const dias = diasDesde(referencia, ahora);
  let estadoSLA = 'OK';
  if (dias >= config.diasAgingRojo) estadoSLA = 'ROJO';
  else if (dias >= config.diasAgingAmarillo) estadoSLA = 'AMARILLO';
  return { tipoLead, fase: 'aging', estadoSLA, diasEnEstado: Math.floor(dias) };
}

async function obtenerConfigSLA() {
  const filas = await prisma.configuracionSLA.findMany();
  const config = { ...CONFIG_SLA_POR_DEFECTO };
  for (const fila of filas) {
    config[fila.tipoLead] = fila;
  }
  return config;
}

// Leads activos (no convertidos, no eliminados) del vendedor, ordenados por
// urgencia (ROJO -> AMARILLO -> OK, y dentro de cada uno el más antiguo
// primero) en vez de por elección del vendedor. vendedorId=null trae los de
// TODOS los vendedores (uso admin, ver GET /demos/prospectos?vendedorId=todos).
async function listarLeadsConSLA(vendedorId) {
  const [demos, configPorTipo] = await Promise.all([
    prisma.demoAsignada.findMany({
      where: {
        vendedorId: vendedorId ? vendedorId : { not: null },
        eliminadoEn: null,
        convertidaEn: null,
        cerradaEn: null,
      },
      include: { empresaDemo: { include: { rubroTemplate: true } }, vendedor: { select: { nombre: true } } },
    }),
    obtenerConfigSLA(),
  ]);

  const ahora = new Date();
  const leads = demos.map((d) => {
    const historial = Array.isArray(d.historialSimulacion) ? d.historialSimulacion : [];
    const { tipoLead, fase, estadoSLA, diasEnEstado } = calcularEstadoSLA(d, configPorTipo, ahora);
    return {
      id: d.id,
      telefono: d.telefono,
      nombreNegocio: d.empresaDemo.nombre,
      nombreEncargado: d.nombreProspecto,
      email: d.email,
      rubro: d.empresaDemo.rubroTemplate.nombre,
      origenDemo: d.origenDemo,
      tipoLead,
      fase,
      estadoSLA,
      diasEnEstado,
      creadoEn: d.creadoEn,
      yaProbo: historial.length > 0,
      primerContactoVendedorEn: d.primerContactoVendedorEn,
      ultimoContactoEfectivoEn: d.ultimoContactoEfectivoEn,
      vendedorId: d.vendedorId,
      vendedorNombre: d.vendedor?.nombre || null,
    };
  });

  leads.sort((a, b) => {
    const diffUrgencia = RANGO_URGENCIA[a.estadoSLA] - RANGO_URGENCIA[b.estadoSLA];
    if (diffUrgencia !== 0) return diffUrgencia;
    return b.diasEnEstado - a.diasEnEstado;
  });

  const contadorVencidos = leads.filter((l) => l.estadoSLA === 'ROJO').length;

  return { leads, contadorVencidos };
}

// Resumen para admin: por cada vendedor, cuántos casos activos tiene y cómo
// se reparten por semáforo SLA. Usado por GET /admin-vendedores/vendedores-kpi
// junto con las conversiones del mes (ver rankingService.conversionesDelMesPorVendedor).
async function resumenLeadsPorVendedor() {
  const [demos, configPorTipo, vendedores] = await Promise.all([
    prisma.demoAsignada.findMany({
      where: { vendedorId: { not: null }, eliminadoEn: null, convertidaEn: null, cerradaEn: null },
      select: { vendedorId: true, origenDemo: true, creadoEn: true, primerContactoVendedorEn: true, ultimoContactoEfectivoEn: true },
    }),
    obtenerConfigSLA(),
    // Un vendedor bloqueado (activo: false) solo desaparece del selector cuando
    // ya no tiene ningún caso activo sin reasignar — mientras le queden, debe
    // seguir apareciendo para que el admin pueda gestionarlos/reasignarlos.
    // Misma condición de "caso activo" que la consulta de demos de arriba.
    prisma.vendedor.findMany({
      where: {
        OR: [
          { activo: true },
          { activo: false, demosCreadas: { some: { eliminadoEn: null, convertidaEn: null, cerradaEn: null } } },
        ],
      },
      select: { id: true, nombre: true, activo: true },
      orderBy: { nombre: 'asc' },
    }),
  ]);

  const ahora = new Date();
  const resumenPorVendedor = new Map(
    vendedores.map((v) => [v.id, { vendedorId: v.id, nombre: v.nombre, activo: v.activo, total: 0, rojo: 0, amarillo: 0, ok: 0 }])
  );

  for (const d of demos) {
    const fila = resumenPorVendedor.get(d.vendedorId);
    if (!fila) continue;
    const { estadoSLA } = calcularEstadoSLA(d, configPorTipo, ahora);
    fila.total += 1;
    if (estadoSLA === 'ROJO') fila.rojo += 1;
    else if (estadoSLA === 'AMARILLO') fila.amarillo += 1;
    else fila.ok += 1;
  }

  return [...resumenPorVendedor.values()];
}

module.exports = { derivarTipoLead, calcularEstadoSLA, obtenerConfigSLA, listarLeadsConSLA, resumenLeadsPorVendedor };
