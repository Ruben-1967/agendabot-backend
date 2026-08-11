/**
 * src/services/rankingService.js
 *
 * Cálculo del ranking mensual de conversión de vendedores. La conversión se
 * cuenta cuando Suscripcion.estado pasa a ACTIVA (Suscripcion.fechaActivacion),
 * no cuando se marca la demo como convertida — ver POST /demos/convertir-a-cliente-real
 * (crea la Empresa) vs POST /admin-vendedores/suscripciones/:empresaId/marcar-activa
 * (dispara la conversión real).
 *
 * No hay tiempo real: el ranking "actual" se recalcula cada 5 minutos por cron
 * (ver src/jobs/rankingCache.js) y se sirve desde RankingCacheActual. El cierre
 * de mes (src/jobs/cierreRankingMensual.js) escribe un snapshot inmutable en
 * RankingMensual que nunca se vuelve a tocar, aunque una conversión se revierta
 * después.
 */
const prisma = require('../lib/prisma');

function limitesDelMes(fecha = new Date()) {
  const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), 1, 0, 0, 0, 0);
  const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1, 0, 0, 0, 0);
  return { inicio, fin };
}

// Devuelve el top 5 (solo vendedores con >=1 conversión) del mes que contiene
// `fecha`, con desempate por jerarquía del mejor plan vendido y luego por la
// conversión más antigua (el primero en llegar a esa cantidad gana el empate).
async function calcularRankingDelMes(fecha = new Date()) {
  const { inicio, fin } = limitesDelMes(fecha);

  const conversiones = await prisma.empresa.findMany({
    where: {
      vendedorId: { not: null },
      suscripcion: { estado: 'ACTIVA', fechaActivacion: { gte: inicio, lt: fin } },
    },
    select: {
      vendedorId: true,
      suscripcion: { select: { plan: true, fechaActivacion: true } },
    },
  });

  const totalConversionesEquipo = conversiones.length;

  if (totalConversionesEquipo === 0) {
    return { posiciones: [], totalConversionesEquipo: 0 };
  }

  const jerarquia = await prisma.jerarquiaPlanDesempate.findMany();
  const ordenPorPlan = Object.fromEntries(jerarquia.map((j) => [j.plan, j.orden]));

  const porVendedor = new Map();
  for (const c of conversiones) {
    const actual = porVendedor.get(c.vendedorId) || { conversiones: 0, mejorOrdenPlan: -1, ultimaConversionEn: null };
    actual.conversiones += 1;
    const ordenPlan = ordenPorPlan[c.suscripcion.plan] ?? 0;
    if (ordenPlan > actual.mejorOrdenPlan) actual.mejorOrdenPlan = ordenPlan;
    if (!actual.ultimaConversionEn || c.suscripcion.fechaActivacion < actual.ultimaConversionEn) {
      actual.ultimaConversionEn = c.suscripcion.fechaActivacion;
    }
    porVendedor.set(c.vendedorId, actual);
  }

  const vendedorIds = [...porVendedor.keys()];
  const vendedores = await prisma.vendedor.findMany({
    where: { id: { in: vendedorIds } },
    select: { id: true, nombre: true },
  });
  const nombrePorId = Object.fromEntries(vendedores.map((v) => [v.id, v.nombre]));

  const filas = vendedorIds
    .map((vendedorId) => ({ vendedorId, nombre: nombrePorId[vendedorId], ...porVendedor.get(vendedorId) }))
    .sort((a, b) => {
      if (b.conversiones !== a.conversiones) return b.conversiones - a.conversiones;
      if (b.mejorOrdenPlan !== a.mejorOrdenPlan) return b.mejorOrdenPlan - a.mejorOrdenPlan;
      return a.ultimaConversionEn - b.ultimaConversionEn;
    });

  const posiciones = filas.slice(0, 5).map((f, i) => ({
    posicion: i + 1,
    vendedorId: f.vendedorId,
    nombre: f.nombre,
    conversiones: f.conversiones,
  }));

  return { posiciones, totalConversionesEquipo };
}

async function recalcularCacheRanking() {
  const { posiciones, totalConversionesEquipo } = await calcularRankingDelMes();
  const config = await prisma.configuracionRankingGlobal.findFirst();
  const metaMinimaGrupalMensual = config?.metaMinimaGrupalMensual ?? 20;

  const ahora = new Date();
  const finDeMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  const diasRestantesDelMes = Math.ceil((finDeMes - ahora) / (1000 * 60 * 60 * 24));

  const dataJson = {
    posiciones,
    totalConversionesEquipo,
    metaMinimaGrupalMensual,
    progresoMetaGrupal: metaMinimaGrupalMensual > 0 ? Math.min(1, totalConversionesEquipo / metaMinimaGrupalMensual) : 0,
    diasRestantesDelMes,
    mes: ahora.getMonth() + 1,
    anio: ahora.getFullYear(),
  };

  const cacheExistente = await prisma.rankingCacheActual.findFirst();
  if (cacheExistente) {
    await prisma.rankingCacheActual.update({ where: { id: cacheExistente.id }, data: { dataJson } });
  } else {
    await prisma.rankingCacheActual.create({ data: { dataJson } });
  }

  return dataJson;
}

// Cierra el ranking del mes que contiene `fecha` (pensado para llamarse el
// día 1 del mes siguiente, con `fecha` apuntando al mes recién terminado).
// Idempotente: si ya existe el snapshot de un vendedor para ese mes/año, no
// lo toca (RankingMensual es intocable una vez escrito).
async function cerrarRankingDelMes(fecha) {
  const { posiciones, totalConversionesEquipo } = await calcularRankingDelMes(fecha);
  const config = await prisma.configuracionRankingGlobal.findFirst();
  const metaMinimaGrupalMensual = config?.metaMinimaGrupalMensual ?? 20;
  const metaGrupalAlcanzada = totalConversionesEquipo >= metaMinimaGrupalMensual;

  const premios = metaGrupalAlcanzada ? await prisma.configuracionPremio.findMany() : [];
  const premioPorPosicion = Object.fromEntries(premios.map((p) => [p.posicion, p.descripcion]));

  const mes = fecha.getMonth() + 1;
  const anio = fecha.getFullYear();

  for (const fila of posiciones) {
    await prisma.rankingMensual.upsert({
      where: { vendedorId_mes_anio: { vendedorId: fila.vendedorId, mes, anio } },
      update: {},
      create: {
        vendedorId: fila.vendedorId,
        mes,
        anio,
        posicion: fila.posicion,
        conversiones: fila.conversiones,
        premioOtorgado: metaGrupalAlcanzada ? (premioPorPosicion[fila.posicion] || null) : null,
        metaGrupalAlcanzada,
      },
    });
  }

  return { mes, anio, posiciones, metaGrupalAlcanzada };
}

// Conversiones del mes por vendedor, SIN limitar al top 5 (a diferencia de
// calcularRankingDelMes) — usado por GET /admin-vendedores/vendedores-kpi
// para mostrar el número real de cada vendedor, no solo el podio.
async function conversionesDelMesPorVendedor(fecha = new Date()) {
  const { inicio, fin } = limitesDelMes(fecha);

  const conversiones = await prisma.empresa.groupBy({
    by: ['vendedorId'],
    where: {
      vendedorId: { not: null },
      suscripcion: { estado: 'ACTIVA', fechaActivacion: { gte: inicio, lt: fin } },
    },
    _count: { _all: true },
  });

  return Object.fromEntries(conversiones.map((c) => [c.vendedorId, c._count._all]));
}

// Igual que conversionesDelMesPorVendedor, pero con un rango de fecha libre
// en vez de asumir el mes en curso — usado por GET /demos/kpis-diarios
// (bloque de KPIs de gestión diaria del panel de vendedores).
async function conversionesEnRangoPorVendedor(inicio, fin) {
  const conversiones = await prisma.empresa.groupBy({
    by: ['vendedorId'],
    where: {
      vendedorId: { not: null },
      suscripcion: { estado: 'ACTIVA', fechaActivacion: { gte: inicio, lt: fin } },
    },
    _count: { _all: true },
  });

  return Object.fromEntries(conversiones.map((c) => [c.vendedorId, c._count._all]));
}

module.exports = {
  limitesDelMes,
  calcularRankingDelMes,
  recalcularCacheRanking,
  cerrarRankingDelMes,
  conversionesDelMesPorVendedor,
  conversionesEnRangoPorVendedor,
};
