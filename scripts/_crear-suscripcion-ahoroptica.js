#!/usr/bin/env node
// Uso puntual (2026-09-07): crea la Suscripcion que le faltaba a Ahorróptica
// (onboardeada a mano, nunca pasó por el flujo normal que la crea). Plan A,
// hosting anual ya pagado (fechaProximoCobroHosting asumida en 1 año desde
// que partió el negocio -- ajustar si la fecha real de pago fue otra),
// mensualidad todavía pendiente.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const existente = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } });
  if (existente) {
    console.error('ABORTADO: Ahorróptica ya tiene una Suscripcion, no se creó una nueva.');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, creadoEn: true } });
  if (!empresa) {
    console.error('ABORTADO: no se encontró la Empresa.');
    process.exit(1);
  }

  const fechaInicio = empresa.creadoEn;
  const fechaProximoCobro = new Date(fechaInicio);
  fechaProximoCobro.setMonth(fechaProximoCobro.getMonth() + 1);
  const fechaProximoCobroHosting = new Date(fechaInicio);
  fechaProximoCobroHosting.setFullYear(fechaProximoCobroHosting.getFullYear() + 1);

  const suscripcion = await prisma.suscripcion.create({
    data: {
      empresaId: EMPRESA_ID,
      plan: 'PLAN_A',
      estado: 'PENDIENTE_PAGO',
      montoMensualActual: 9900,
      citasIncluidas: 100,
      precioCitaExcedente: 150,
      exentoDeHosting: false,
      fechaInicio,
      fechaProximoCobro,
      fechaProximoCobroHosting,
    },
  });

  console.log('Creada:', JSON.stringify(suscripcion, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
