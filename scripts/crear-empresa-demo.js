/**
 * Crea una Empresa de demo (esDemo: true), vinculada a un RubroTemplate
 * existente por su `clave` (ej. "optica", "panaderia_gourmet").
 *
 * Uso:
 *   node scripts/crear-empresa-demo.js <nombre> <claveRubro>
 *
 * Ejemplo:
 *   node scripts/crear-empresa-demo.js "Óptica Demo" optica
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const [nombre, claveRubro] = process.argv.slice(2);

  if (!nombre || !claveRubro) {
    console.error('Uso: node scripts/crear-empresa-demo.js <nombre> <claveRubro>');
    process.exit(1);
  }

  const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: claveRubro } });
  if (!rubro) {
    console.error(`No existe ningún RubroTemplate con clave "${claveRubro}"`);
    process.exit(1);
  }

  const empresaDemo = await prisma.empresa.create({
    data: {
      nombre,
      rubroTemplateId: rubro.id,
      esDemo: true,
    },
  });

  console.log(`Empresa de demo creada: "${empresaDemo.nombre}" (rubro: ${rubro.nombre})`);
  console.log(`ID: ${empresaDemo.id}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error creando empresa de demo:', error);
  process.exit(1);
});