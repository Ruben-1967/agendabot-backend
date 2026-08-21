/**
 * Carga (o actualiza) los items del Catálogo Visual de la demo comercial
 * para un rubro. No hay pantalla de panel para esto — se carga por script,
 * a propósito (dataset fijo y chico, máx. 4 items activos por rubro).
 *
 * Uso:
 *   node scripts/seed-catalogo-demo.js <claveRubro> <archivoJson>
 *
 * El archivo JSON es un arreglo de items:
 *   [{ "categoria": "Armazones", "nombre": "Armazón cuadrado negro", "imagenUrl": "https://...", "orden": 0 }, ...]
 *
 * Ejemplo:
 *   node scripts/seed-catalogo-demo.js optica items-optica.json
 */
const fs = require('fs');
const prisma = require('../src/lib/prisma');

async function main() {
  const [claveRubro, archivoJson] = process.argv.slice(2);

  if (!claveRubro || !archivoJson) {
    console.error('Uso: node scripts/seed-catalogo-demo.js <claveRubro> <archivoJson>');
    process.exit(1);
  }

  const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: claveRubro } });
  if (!rubro) {
    console.error(`No existe ningún RubroTemplate con clave "${claveRubro}"`);
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(archivoJson, 'utf-8'));
  if (!Array.isArray(items) || items.length === 0) {
    console.error('El archivo JSON debe ser un arreglo no vacío de items.');
    process.exit(1);
  }
  if (items.length > 4) {
    console.warn(`Advertencia: ${items.length} items — la convención es máximo 4 activos por rubro en la demo (no hay enforcement duro, pero revisa si es intencional).`);
  }

  // Reemplaza el catálogo completo del rubro (borra lo anterior, crea lo
  // nuevo) — más simple que hacer upsert item por item para un dataset tan
  // chico y de carga poco frecuente.
  await prisma.catalogoDemoItem.deleteMany({ where: { rubroTemplateId: rubro.id } });

  for (const [i, item] of items.entries()) {
    if (!item.categoria || !item.nombre || !item.imagenUrl) {
      console.error(`Item en posición ${i} incompleto (falta categoria/nombre/imagenUrl):`, item);
      process.exit(1);
    }
    await prisma.catalogoDemoItem.create({
      data: {
        rubroTemplateId: rubro.id,
        categoria: item.categoria,
        nombre: item.nombre,
        imagenUrl: item.imagenUrl,
        orden: item.orden ?? i,
        activo: item.activo ?? true,
      },
    });
  }

  console.log(`Catálogo demo cargado para "${rubro.nombre}" (${claveRubro}): ${items.length} items.`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error cargando catálogo demo:', error);
  process.exit(1);
});
