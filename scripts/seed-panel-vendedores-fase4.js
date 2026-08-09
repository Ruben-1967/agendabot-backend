/**
 * Seed inicial para el Panel de Vendedores Fase 4: jerarquía de planes
 * (desempate del ranking), umbrales de SLA/aging, posiciones de premio
 * y meta grupal mensual. Todos los valores son ajustables después desde
 * el panel admin — esto solo deja filas base para que las pantallas no
 * arranquen vacías.
 *
 * Uso (Shell de Render, agendabot-backend-staging primero, luego producción):
 *   node scripts/seed-panel-vendedores-fase4.js
 *
 * Idempotente: usa upsert, se puede correr más de una vez sin duplicar filas.
 */
const prisma = require('../src/lib/prisma');

async function main() {
  try {
    // Jerarquía de planes para desempate del ranking (mayor orden = mejor)
    await prisma.jerarquiaPlanDesempate.upsert({
      where: { plan: 'PLAN_INICIO_LEGACY' },
      update: {},
      create: { plan: 'PLAN_INICIO_LEGACY', orden: 0 },
    });
    await prisma.jerarquiaPlanDesempate.upsert({
      where: { plan: 'PLAN_A' },
      update: {},
      create: { plan: 'PLAN_A', orden: 1 },
    });
    await prisma.jerarquiaPlanDesempate.upsert({
      where: { plan: 'PLAN_B' },
      update: {},
      create: { plan: 'PLAN_B', orden: 2 },
    });
    await prisma.jerarquiaPlanDesempate.upsert({
      where: { plan: 'PLAN_C' },
      update: {},
      create: { plan: 'PLAN_C', orden: 3 },
    });
    console.log('JerarquiaPlanDesempate: OK');

    // SLA/aging — valores iniciales tomados del brief, editables desde admin
    await prisma.configuracionSLA.upsert({
      where: { tipoLead: 'CALIENTE' },
      update: {},
      create: {
        tipoLead: 'CALIENTE',
        diasPrimerContactoAmarillo: 2,
        diasPrimerContactoRojo: 3,
        diasAgingAmarillo: 5,
        diasAgingRojo: 8,
      },
    });
    await prisma.configuracionSLA.upsert({
      where: { tipoLead: 'FRIO' },
      update: {},
      create: {
        tipoLead: 'FRIO',
        diasPrimerContactoAmarillo: 3,
        diasPrimerContactoRojo: 5,
        diasAgingAmarillo: 8,
        diasAgingRojo: 15,
      },
    });
    console.log('ConfiguracionSLA: OK');

    // Premios por posición 1-5 — descripción/monto en blanco, admin los completa
    for (let posicion = 1; posicion <= 5; posicion++) {
      await prisma.configuracionPremio.upsert({
        where: { posicion },
        update: {},
        create: { posicion, descripcion: 'Por definir', monto: null },
      });
    }
    console.log('ConfiguracionPremio: OK');

    // Meta mínima grupal mensual (fila única)
    const metaExistente = await prisma.configuracionRankingGlobal.findFirst();
    if (!metaExistente) {
      await prisma.configuracionRankingGlobal.create({
        data: { metaMinimaGrupalMensual: 20 },
      });
    }
    console.log('ConfiguracionRankingGlobal: OK');

    console.log('Seed completo.');
    process.exit(0);
  } catch (error) {
    console.error('Error en seed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
