/**
 * Diagnóstico: cuenta cuántos CatalogoDemoItem hay por (rubro, categoría),
 * para confirmar si el catálogo real (no "Remate Panel") tiene más de 1
 * imagen por categoría o si cada categoría efectivamente solo tiene 1.
 *
 * Uso: node scripts/_revisar-items-catalogo-por-categoria.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const items = await prisma.catalogoDemoItem.findMany({
    include: { rubroTemplate: { select: { nombre: true, clave: true } } },
    orderBy: [{ rubroTemplateId: 'asc' }, { categoria: 'asc' }, { orden: 'asc' }],
  });

  const porRubro = {};
  for (const item of items) {
    const clave = item.rubroTemplate.clave;
    (porRubro[clave] ||= { nombre: item.rubroTemplate.nombre, porCategoria: {} });
    (porRubro[clave].porCategoria[item.categoria] ||= []).push(item);
  }

  for (const [clave, grupo] of Object.entries(porRubro)) {
    console.log(`\n=== ${grupo.nombre} (${clave}) ===`);
    for (const [categoria, itemsCategoria] of Object.entries(grupo.porCategoria)) {
      console.log(`  "${categoria}": ${itemsCategoria.length} item(s) — ${itemsCategoria.map((i) => `${i.nombre}(activo=${i.activo})`).join(', ')}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
