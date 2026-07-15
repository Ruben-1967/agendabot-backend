/**
 * Crea el catálogo inicial de Producto de una empresa a partir del catálogo
 * sugerido en su RubroTemplate.serviciosBase (solo tiene sentido para rubros
 * con modoOperacion = CATALOGO_ROTATIVO, ej. panadería gourmet).
 *
 * Uso:
 *   node scripts/importar-catalogo-desde-rubro.js <empresaId>
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const [empresaId] = process.argv.slice(2);

  if (!empresaId) {
    console.error('Uso: node scripts/importar-catalogo-desde-rubro.js <empresaId>');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: { rubroTemplate: true },
  });

  if (!empresa) {
    console.error(`No existe ninguna Empresa con id "${empresaId}"`);
    process.exit(1);
  }

  if (empresa.rubroTemplate.modoOperacion !== 'CATALOGO_ROTATIVO') {
    console.error(
      `La empresa "${empresa.nombre}" tiene rubro "${empresa.rubroTemplate.nombre}", ` +
      `que no es de tipo CATALOGO_ROTATIVO. Este script es solo para ese tipo de rubro.`
    );
    process.exit(1);
  }

  const catalogoSugerido = empresa.rubroTemplate.serviciosBase; // [{ nombre, precio, unidad }, ...]

  if (!Array.isArray(catalogoSugerido) || catalogoSugerido.length === 0) {
    console.error('El RubroTemplate de esta empresa no tiene catálogo sugerido para importar.');
    process.exit(1);
  }

  let creados = 0;
  for (const item of catalogoSugerido) {
    const yaExiste = await prisma.producto.findFirst({
      where: { empresaId: empresa.id, nombre: item.nombre },
    });

    if (yaExiste) {
      console.log(`  - "${item.nombre}" ya existe para esta empresa, se omite.`);
      continue;
    }

    await prisma.producto.create({
      data: {
        empresaId: empresa.id,
        nombre: item.nombre,
        precio: item.precio,
        unidad: item.unidad || 'unidad',
      },
    });
    creados++;
    console.log(`  + Producto creado: ${item.nombre} ($${item.precio}/${item.unidad || 'unidad'})`);
  }

  console.log(`\nListo: ${creados} productos creados para "${empresa.nombre}".`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error importando catálogo:', error);
  process.exit(1);
});
