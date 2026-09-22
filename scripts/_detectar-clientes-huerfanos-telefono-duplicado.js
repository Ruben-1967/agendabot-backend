#!/usr/bin/env node
// Uso puntual (solo lectura, NO repara nada): detecta Cliente ya
// duplicados/huérfanos por el bug de Cliente.telefono sobrescrito (ver
// memoria del proyecto: project_bug_cliente_duplicado_rut_telefono.md,
// corregido 2026-09-22 hacia adelante -- este script busca casos YA
// existentes en datos históricos, de negocios con requiereRut=true).
//
// Firma del bug: un Cliente con relaciones reales (citas, ventas, etc.)
// pero SIN ninguna Conversacion propia -- señal de que su telefono quedó
// sobrescrito y el chatbot dejó de encontrarlo, creando otro Cliente para
// seguir la conversación.
//
// Exporta la lista para revisión MANUAL -- la fusión de duplicados nunca
// es automática (ver punto 8 del plan en memoria: riesgo de fusionar 2
// personas distintas por error).
//
// USO (Shell de Render, producción):
//   node scripts/_detectar-clientes-huerfanos-telefono-duplicado.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresasConRut = await prisma.empresa.findMany({
    where: { requiereRut: true },
    select: { id: true, nombre: true },
  });

  if (empresasConRut.length === 0) {
    console.log('Ningún negocio tiene requiereRut=true -- nada que revisar.');
    return;
  }

  let totalSospechosos = 0;

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        OR: [
          { citas: { some: {} } },
          { ventas: { some: {} } },
          { listaEspera: { some: {} } },
          { pedidos: { some: {} } },
          { atencionesClinicas: { some: {} } },
        ],
      },
      include: {
        _count: { select: { citas: true, ventas: true, listaEspera: true, pedidos: true, atencionesClinicas: true } },
      },
    });

    if (candidatos.length === 0) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Empresa: ${empresa.nombre} (${empresa.id})`);
    console.log(`${candidatos.length} Cliente(s) sospechoso(s) (sin Conversacion propia, con relaciones reales):`);
    for (const c of candidatos) {
      totalSospechosos++;
      console.log(`  - id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}" rut=${c.rut ? '(tiene)' : '(sin rut)'} creadoEn=${c.creadoEn.toISOString()}`);
      console.log(`    citas=${c._count.citas} ventas=${c._count.ventas} listaEspera=${c._count.listaEspera} pedidos=${c._count.pedidos} atencionesClinicas=${c._count.atencionesClinicas}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total Cliente sospechosos encontrados: ${totalSospechosos}`);
  console.log('\nEsto NO repara nada -- es solo para revisión manual. Cada caso hay que');
  console.log('confirmarlo a mano (¿es de verdad la misma persona que el Cliente activo?)');
  console.log('antes de fusionar, nunca automático.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
