#!/usr/bin/env node
// Uso puntual, SOLO LECTURA: audita si existen citas PENDIENTE/CONFIRMADA
// ya solapadas (mismo recursoAgendableId, rangos de tiempo que se cruzan)
// en TODA la base de producción -- paso previo obligatorio antes de correr
// scripts/_migracion-exclude-constraint-doble-reserva.js ahí, porque el
// EXCLUDE constraint no se puede crear si ya existe algún solapamiento
// (Postgres lo rechaza con un error claro, pero mejor saberlo de antemano
// y con contexto legible en vez de un error crudo).
//
// A diferencia de scripts/_limpieza-citas-solapadas-staging.js (que SÍ
// cancela automáticamente, porque ahí se confirmó que todo era data de
// demo/seed), este script NUNCA cambia nada -- cada caso encontrado acá
// debe revisarse a mano con el negocio antes de decidir cuál cita cancelar
// (si es que corresponde cancelar alguna; puede que ninguna de las dos
// tenga que perderse y haya que resolverlo de otra forma, ej. reasignando
// una a otro profesional).
//
// USO (Shell de Render, producción):
//   node scripts/_auditoria-citas-solapadas-produccion.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const pares = await prisma.$queryRawUnsafe(`
    SELECT
      a."id" as id_a, b."id" as id_b,
      a."empresaId" as empresa_id,
      a."recursoAgendableId" as recurso_id,
      a."fechaHoraInicio" as inicio_a, a."fechaHoraFin" as fin_a,
      b."fechaHoraInicio" as inicio_b, b."fechaHoraFin" as fin_b,
      a."clienteId" as cliente_a, b."clienteId" as cliente_b,
      a."creadoEn" as creado_a, b."creadoEn" as creado_b
    FROM "Cita" a
    JOIN "Cita" b ON a."recursoAgendableId" = b."recursoAgendableId"
      AND a."id" < b."id"
      AND tsrange(a."fechaHoraInicio", a."fechaHoraFin") && tsrange(b."fechaHoraInicio", b."fechaHoraFin")
    WHERE a."estado" IN ('PENDIENTE','CONFIRMADA') AND b."estado" IN ('PENDIENTE','CONFIRMADA')
    ORDER BY a."empresaId", a."fechaHoraInicio"
  `);

  if (pares.length === 0) {
    console.log('✅ No se encontró ningún solapamiento real. El constraint se puede crear directamente con:\n   node scripts/_migracion-exclude-constraint-doble-reserva.js');
    return;
  }

  console.log(`⚠️  Se encontraron ${pares.length} par(es) de citas solapadas. Revisar cada uno ANTES de crear el constraint.\n`);

  for (const p of pares) {
    const empresa = await prisma.empresa.findUnique({ where: { id: p.empresa_id }, select: { nombre: true } });
    const clienteA = await prisma.cliente.findUnique({ where: { id: p.cliente_a }, select: { nombre: true, telefono: true } });
    const clienteB = await prisma.cliente.findUnique({ where: { id: p.cliente_b }, select: { nombre: true, telefono: true } });

    console.log('='.repeat(70));
    console.log(`Empresa: ${empresa?.nombre || p.empresa_id} — recurso: ${p.recurso_id}`);
    console.log(`  Cita A: ${p.id_a} | ${clienteA?.nombre} (${clienteA?.telefono}) | ${new Date(p.inicio_a).toISOString()} → ${new Date(p.fin_a).toISOString()} | creada ${new Date(p.creado_a).toISOString()}`);
    console.log(`  Cita B: ${p.id_b} | ${clienteB?.nombre} (${clienteB?.telefono}) | ${new Date(p.inicio_b).toISOString()} → ${new Date(p.fin_b).toISOString()} | creada ${new Date(p.creado_b).toISOString()}`);
  }

  console.log(`\nNo se cambió nada. Resolver cada caso a mano (revisar con el negocio cuál cita es la válida) y recién después correr la migración.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
