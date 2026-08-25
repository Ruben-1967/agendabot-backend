// Script de backfill, uso único — casos convertidos ANTES de que existiera
// origenCaso quedan sin clasificar. Se marcan como 'organico' por default,
// consistente con "se asumía que todo era esfuerzo propio" hasta ahora
// (decisión de negocio, ver prompt de trazabilidad heredado/organico).
// Actualiza tanto DemoAsignada (fuente) como Empresa (copia usada en el
// reporte) para los casos ya convertidos.
const prisma = require('../src/lib/prisma');

async function main() {
  const demosSinClasificar = await prisma.demoAsignada.findMany({
    where: { origenCaso: null },
    select: { id: true, telefono: true },
  });
  console.log(`DemoAsignada sin origenCaso: ${demosSinClasificar.length}`);
  if (demosSinClasificar.length > 0) {
    const resultado = await prisma.demoAsignada.updateMany({
      where: { origenCaso: null },
      data: { origenCaso: 'organico' },
    });
    console.log(`  -> ${resultado.count} DemoAsignada marcadas 'organico'.`);
  }

  const empresasSinClasificar = await prisma.empresa.findMany({
    where: { esDemo: false, origenCaso: null },
    select: { id: true, nombre: true },
  });
  console.log(`\nEmpresa (esDemo:false) sin origenCaso: ${empresasSinClasificar.length}`);
  for (const e of empresasSinClasificar) {
    console.log(`  - ${e.nombre} (${e.id})`);
  }
  if (empresasSinClasificar.length > 0) {
    const resultado = await prisma.empresa.updateMany({
      where: { esDemo: false, origenCaso: null },
      data: { origenCaso: 'organico' },
    });
    console.log(`  -> ${resultado.count} Empresa marcadas 'organico'.`);
  }

  console.log('\nBackfill terminado.');
}

main()
  .catch((err) => { console.error('Error en backfill:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
