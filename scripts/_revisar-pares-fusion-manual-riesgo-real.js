#!/usr/bin/env node
// Uso puntual, solo lectura: para cada par "REVISIÓN MANUAL" que reporta
// _normalizar-telefono-clientes-riesgo-real.js, muestra las relaciones
// reales de AMBOS Cliente del par -- distingue el caso seguro (el gemelo
// está vacío, como pasó con Diego -- ahí fusionar es solo "recuperar a la
// misma persona") del caso NO seguro (el gemelo también tiene citas/
// ventas reales propias -- podrían ser 2 personas distintas compartiendo
// teléfono, ej. familiares, y fusionar a ciegas mezclaría fichas de 2
// personas). No repara nada.
//
// USO (Shell de Render, producción):
//   node scripts/_revisar-pares-fusion-manual-riesgo-real.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

function pareceFormatoMetaValido(telefono) {
  return /^\d{8,15}$/.test(telefono || '');
}
function normalizar(telefono) {
  return (telefono || '').replace(/[^\d]/g, '');
}

async function contarRelaciones(clienteId) {
  const c = await prisma.cliente.findUnique({
    where: { id: clienteId },
    include: { _count: { select: { citas: true, ventas: true, listaEspera: true, pedidos: true, atencionesClinicas: true, conversaciones: true } } },
  });
  return c;
}

async function main() {
  const empresasConRut = await prisma.empresa.findMany({ where: { requiereRut: true }, select: { id: true, nombre: true } });
  const ahora = new Date();

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        citas: { some: { estado: 'PENDIENTE', fechaHoraInicio: { gt: ahora } } },
      },
    });
    const malFormados = candidatos.filter((c) => !pareceFormatoMetaValido(c.telefono));
    if (malFormados.length === 0) continue;

    console.log(`\nEmpresa: ${empresa.nombre}\n${'='.repeat(60)}`);

    for (const c of malFormados) {
      const normalizado = normalizar(c.telefono);
      if (!normalizado) continue;
      const colision = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono: normalizado, NOT: { id: c.id } } });
      if (!colision) continue; // esos ya se resuelven solos con el script de normalización

      const infoA = await contarRelaciones(c.id);
      const infoB = await contarRelaciones(colision.id);
      const totalB = Object.values(infoB._count).reduce((a, b) => a + b, 0) - infoB._count.conversaciones; // conversaciones no cuenta como "relación real" propia

      console.log(`\nPar: "${c.nombre}" (${c.id}) <-> "${colision.nombre}" (${colision.id})`);
      console.log(`  "${c.nombre}": citas=${infoA._count.citas} ventas=${infoA._count.ventas} listaEspera=${infoA._count.listaEspera} pedidos=${infoA._count.pedidos} atencionesClinicas=${infoA._count.atencionesClinicas} conversaciones=${infoA._count.conversaciones}`);
      console.log(`  "${colision.nombre}": citas=${infoB._count.citas} ventas=${infoB._count.ventas} listaEspera=${infoB._count.listaEspera} pedidos=${infoB._count.pedidos} atencionesClinicas=${infoB._count.atencionesClinicas} conversaciones=${infoB._count.conversaciones}`);
      if (totalB === 0) {
        console.log(`  ✅ SEGURO: "${colision.nombre}" no tiene relaciones reales propias -- mismo patrón que Diego, probablemente la misma persona.`);
      } else {
        console.log(`  ⚠️  NO ASUMIR: "${colision.nombre}" SÍ tiene relaciones reales propias -- podrían ser 2 personas distintas compartiendo teléfono (ej. familiares). Hay que preguntarle al negocio antes de fusionar.`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
