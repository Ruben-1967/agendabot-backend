/**
 * Inyecta citas de prueba HOY, distribuidas de forma DESIGUAL entre los 2
 * profesionales (2 para el primero, 1 para el segundo) — para verificar
 * visualmente que el filtro por profesional del Dashboard realmente
 * separa los datos y no solo muestra lo mismo sin importar la selección.
 *
 * Uso (Shell de Render, agendabot-backend-staging):
 *   node scripts/inyectar-citas-dashboard-prueba.js
 */
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = '43038d5b-201c-4249-b1ed-377684efa1a2';

async function main() {
  try {
    const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: EMPRESA_ID } });
    if (recursos.length < 2) {
      console.error('Esta empresa no tiene 2 profesionales todavía. Crea el segundo primero desde el panel.');
      process.exit(1);
    }

    const [recursoA, recursoB] = recursos;
    const hoy = new Date();

    // 2 citas para el primer profesional
    for (let i = 0; i < 2; i++) {
      const cliente = await prisma.cliente.create({
        data: {
          empresaId: EMPRESA_ID,
          nombre: `Paciente ${recursoA.nombre} ${i + 1}`,
          telefono: `+56911111${100 + i}`,
        },
      });
      const inicio = new Date(hoy);
      inicio.setHours(10 + i, 0, 0, 0);
      const fin = new Date(inicio.getTime() + (recursoA.duracionCitaMinutos || 30) * 60000);
      const cita = await prisma.cita.create({
        data: {
          empresaId: EMPRESA_ID,
          clienteId: cliente.id,
          recursoAgendableId: recursoA.id,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          estado: i === 0 ? 'CONFIRMADA' : 'PENDIENTE',
          origenCanal: 'panel',
        },
      });
      console.log(`Cita creada para ${recursoA.nombre}: ${cliente.nombre} a las ${inicio.toLocaleTimeString('es-CL')} (${cita.estado})`);
    }

    // 1 cita para el segundo profesional
    const clienteB = await prisma.cliente.create({
      data: {
        empresaId: EMPRESA_ID,
        nombre: `Paciente ${recursoB.nombre} 1`,
        telefono: '+56911111200',
      },
    });
    const inicioB = new Date(hoy);
    inicioB.setHours(15, 0, 0, 0);
    const finB = new Date(inicioB.getTime() + (recursoB.duracionCitaMinutos || 30) * 60000);
    const citaB = await prisma.cita.create({
      data: {
        empresaId: EMPRESA_ID,
        clienteId: clienteB.id,
        recursoAgendableId: recursoB.id,
        fechaHoraInicio: inicioB,
        fechaHoraFin: finB,
        estado: 'CONFIRMADA',
        origenCanal: 'panel',
      },
    });
    console.log(`Cita creada para ${recursoB.nombre}: ${clienteB.nombre} a las ${inicioB.toLocaleTimeString('es-CL')} (${citaB.estado})`);

    console.log('');
    console.log(`Total: 2 citas para "${recursoA.nombre}", 1 cita para "${recursoB.nombre}". "Todos" debería mostrar 3.`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();