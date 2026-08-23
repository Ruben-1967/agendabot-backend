/**
 * Verificación E2E con Claude real: indagación -> confirma fotos -> tool
 * mostrar_catalogo_visual_demo -> catálogo real + remate (categoría
 * "Remate Panel") -> queda listo el cierre elaborado (se dispara en
 * server.js al recibir interactivo.remate, no en esta función).
 *
 * Crea datos temporales (rubro Óptica): activa el switch, agrega 2 items
 * de "Armazones" + 1 item "Remate Panel", crea una DemoAsignada de
 * prueba, corre 3 turnos, y limpia todo al final (incluso si falla algo
 * a mitad de camino).
 *
 * Uso: node scripts/_verificar-remate-catalogo-demo-e2e.js
 */
const prisma = require('../src/lib/prisma');
const { procesarMensajeDemo } = require('../src/services/demoEngine');

const TELEFONO_PRUEBA = '56900000099';

async function main() {
  const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: 'optica' } });
  const switchOriginal = rubro.catalogoVisualDemoActivo;

  let empresaDemo, demoAsignada;

  try {
    await prisma.rubroTemplate.update({ where: { id: rubro.id }, data: { catalogoVisualDemoActivo: true } });

    await prisma.catalogoDemoItem.create({
      data: { rubroTemplateId: rubro.id, categoria: 'Armazones', nombre: 'Armazon_Clasico_Test', imagenUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', orden: 1 },
    });
    await prisma.catalogoDemoItem.create({
      data: { rubroTemplateId: rubro.id, categoria: 'Armazones', nombre: 'Armazon_Moderno_Test', imagenUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', orden: 2 },
    });
    const itemRemate = await prisma.catalogoDemoItem.create({
      data: { rubroTemplateId: rubro.id, categoria: 'Remate Panel', nombre: 'Dashboard_Test', imagenUrl: 'https://res.cloudinary.com/demo/image/upload/dashboard-test.jpg', orden: 0 },
    });

    empresaDemo = await prisma.empresa.create({
      data: { nombre: '_TEST_E2E_REMATE_CLAUDE', rubroTemplateId: rubro.id, esDemo: true },
    });
    demoAsignada = await prisma.demoAsignada.create({
      data: { telefono: TELEFONO_PRUEBA, empresaDemoId: empresaDemo.id, nombreProspecto: 'Prospecto E2E', origenDemo: 'organico' },
    });

    async function turno(mensajeTexto, etiqueta) {
      const demoActual = await prisma.demoAsignada.findUnique({
        where: { id: demoAsignada.id },
        include: { empresaDemo: { include: { rubroTemplate: true } } },
      });
      const resultado = await procesarMensajeDemo({
        demoAsignada: demoActual,
        telefonoCliente: TELEFONO_PRUEBA,
        mensaje: { type: 'text', text: { body: mensajeTexto } },
        nombreContacto: 'Prospecto E2E',
      });
      console.log(`\n=== [${etiqueta}] Cliente dice: "${mensajeTexto}" ===`);
      console.log('Texto respuesta:', resultado.respuestaTexto);
      console.log('Interactivo:', JSON.stringify(resultado.interactivo, null, 2));
      return resultado;
    }

    await turno('Hola', 'A: inicio');
    await turno('Tienen armazones que me puedan mostrar?', 'B: pregunta por armazones');
    const r3 = await turno('Si, muéstrame', 'C: confirma que quiere ver fotos');

    console.log('\n=== VERIFICACIONES ===');
    console.log('C: interactivo.tipo === catalogo_imagenes_demo:', r3.interactivo?.tipo === 'catalogo_imagenes_demo');
    console.log('C: items mostrados son de Armazones (no Remate Panel):', JSON.stringify(r3.interactivo?.items?.map((i) => i.nombre)));
    console.log('C: remate.imagenUrl coincide con el item Remate Panel:', r3.interactivo?.remate?.imagenUrl === itemRemate.imagenUrl);
    console.log('C: remate.texto:', r3.interactivo?.remate?.texto);
  } finally {
    if (demoAsignada) await prisma.demoAsignada.delete({ where: { id: demoAsignada.id } }).catch(() => {});
    if (empresaDemo) await prisma.empresa.delete({ where: { id: empresaDemo.id } }).catch(() => {});
    await prisma.catalogoDemoItem.deleteMany({ where: { rubroTemplateId: rubro.id, nombre: { in: ['Armazon_Clasico_Test', 'Armazon_Moderno_Test', 'Dashboard_Test'] } } }).catch(() => {});
    await prisma.rubroTemplate.update({ where: { id: rubro.id }, data: { catalogoVisualDemoActivo: switchOriginal } }).catch(() => {});
    console.log('\nLimpieza completa. Switch catalogoVisualDemoActivo restaurado a:', switchOriginal);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
