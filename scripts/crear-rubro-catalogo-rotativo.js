require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const existente = await prisma.rubroTemplate.findUnique({ where: { clave: 'catalogo_rotativo' } });
  if (existente) {
    console.log('El rubro "catalogo_rotativo" ya existe, no se crea de nuevo.');
    process.exit(0);
  }

  const rubro = await prisma.rubroTemplate.create({
    data: {
      clave: 'catalogo_rotativo',
      nombre: 'Catálogo rotativo (venta proactiva)',
      modoOperacion: 'CATALOGO_ROTATIVO',
      camposFicha: {},
      serviciosBase: [], // el catálogo real se carga como Producto, no acá
      automatizacionesBase: [
        'aviso_catalogo_diario',
        'encuesta_satisfaccion',
      ],
    },
  });

  console.log(`RubroTemplate creado: ${rubro.nombre} (clave: ${rubro.clave}) — id ${rubro.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});