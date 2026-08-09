/**
 * Inyecta 2 citas de prueba HOY, una para cada uno de los 2 profesionales
 * existentes en la empresa de prueba multi-profesional, para verificar
 * visualmente que el filtro por profesional del Dashboard funciona.
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

    const hoy = new Date();

    for (let i = 0; i < recursos.length; i++) {
      const recurso = recursos[i];
      const cliente = await prisma.cliente.create({
        data: {
          empresaId: EMPRESA_ID,
          nombre: `Paciente Prueba ${i + 1} (${recurso.nombre})`,
          telefono: `+5691111111${i}`,
        },
      });

      const inicio = new Date(hoy);
      inicio.setHours(10 + i, 0, 0, 0);
      const fin = new Date(inicio.getTime() + (recurso.duracionCitaMinutos || 30) * 60000);

      const cita = await prisma.cita.create({
        data: {
          empresaId: EMPRESA_ID,
          clienteId: cliente.id,
          recursoAgendableId: recurso.id,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          estado: i === 0 ? 'CONFIRMADA' : 'PENDIENTE',
          origenCanal: 'panel',
        },
      });

      console.log(`Cita creada para ${recurso.nombre}: ${cliente.nombre} a las ${inicio.toLocaleTimeString('es-CL')} (${cita.estado})`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();