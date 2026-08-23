/**
 * Diagnóstico: lista todos los CatalogoDemoItem con categoria "Remate
 * Panel" para cada rubro, para detectar si quedó más de uno (el más
 * antiguo, por menor `orden`, es el que se usa — puede no ser el que se
 * subió más recientemente si no se borró el anterior).
 *
 * Uso: node scripts/_revisar-items-remate-panel.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const items = await prisma.catalogoDemoItem.findMany({
    where: { categoria: 'Remate Panel' },
    include: { rubroTemplate: { select: { nombre: true, clave: true } } },
    orderBy: [{ rubroTemplateId: 'asc' }, { orden: 'asc' }],
  });

  if (items.length === 0) {
    console.log('No hay ningún item con categoría "Remate Panel" todavía.');
  }

  // Agrupa por rubro para calcular cuál gana según la MISMA regla que usa
  // remateParaRubro en demoEngine.js: activo:true, menor `orden` primero.
  const porRubro = {};
  for (const item of items) {
    (porRubro[item.rubroTemplate.clave] ||= { nombre: item.rubroTemplate.nombre, items: [] }).items.push(item);
  }

  for (const [clave, grupo] of Object.entries(porRubro)) {
    console.log(`\n=== ${grupo.nombre} (${clave}) ===`);
    const ganador = grupo.items.find((i) => i.activo);
    for (const item of grupo.items) {
      const esGanador = ganador && item.id === ganador.id;
      console.log(`  ${esGanador ? '-> ESTE se usa' : '   (sobrante, no se usa)'} orden=${item.orden} activo=${item.activo} nombre="${item.nombre}" id=${item.id}`);
      console.log(`     ${item.imagenUrl}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
