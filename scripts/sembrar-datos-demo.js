/**
 * Siembra datos mínimos realistas en una Empresa de demo, para que el
 * motor real de chatbot tenga algo genuino que responder durante la
 * simulación (en vez de caer siempre en el mensaje de respaldo genérico).
 *
 * Uso:
 *   node scripts/sembrar-datos-demo.js <empresaId>
 *
 * Ejemplo:
 *   node scripts/sembrar-datos-demo.js b428408f-e347-4c1a-aae9-b70df7076fd1
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const [empresaId] = process.argv.slice(2);

  if (!empresaId) {
    console.error('Uso: node scripts/sembrar-datos-demo.js <empresaId>');
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

  if (!empresa.esDemo) {
    console.warn(`Advertencia: "${empresa.nombre}" no está marcada como esDemo=true. Continuando de todos modos...`);
  }

  // Un profesional/recurso de ejemplo, con horario de lunes a viernes 9-18h
  const recurso = await prisma.recursoAgendable.create({
    data: {
      empresaId: empresa.id,
      nombre: 'Profesional de turno',
      tipo: 'profesional',
      duracionCitaMinutos: 30,
      horarios: {
        create: [1, 2, 3, 4, 5].map((dia) => ({
          diaSemana: dia,
          horaInicio: '09:00',
          horaFin: '18:00',
        })),
      },
    },
  });
  console.log(`+ Recurso agendable creado: "${recurso.nombre}"`);

  // Servicios de ejemplo, genéricos pero creíbles para el rubro de la demo
  const serviciosPorRubro = {
    optica: ['Examen de la vista', 'Ajuste de armazón', 'Control de lentes de contacto'],
    centro_estetico: ['Limpieza facial', 'Masaje relajante', 'Depilación láser'],
    salud_independiente: ['Consulta general', 'Control de seguimiento'],
    mantencion_tecnica: ['Mantención preventiva', 'Diagnóstico de equipo'],
  };

  const nombresServicios = serviciosPorRubro[empresa.rubroTemplate.clave] || ['Servicio de ejemplo 1', 'Servicio de ejemplo 2'];

  for (const nombre of nombresServicios) {
    await prisma.servicio.create({
      data: { empresaId: empresa.id, nombre, duracionMinutos: 30 },
    });
    console.log(`+ Servicio creado: "${nombre}"`);
  }

  console.log(`\nListo: datos de ejemplo sembrados para "${empresa.nombre}".`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error sembrando datos de demo:', error);
  process.exit(1);
});