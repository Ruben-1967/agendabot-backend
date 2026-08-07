/**
 * Asigna PLAN_B a la empresa de prueba creada por
 * crear-prueba-multiprofesional.js, para probar el caso positivo
 * del límite de profesionales (debería subir de 1 a 2).
 *
 * Uso (Shell de Render, agendabot-backend-staging):
 *   node scripts/asignar-plan-b-prueba.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  try {
    const empresa = await prisma.empresa.findFirst({
      where: { nombre: 'Demo Test Multiprofesional' },
    });
    if (!empresa) {
      console.error('No se encontró la empresa de prueba. Corre primero crear-prueba-multiprofesional.js');
      process.exit(1);
    }

    const suscripcion = await prisma.suscripcion.create({
      data: {
        empresaId: empresa.id,
        plan: 'PLAN_B',
        estado: 'ACTIVA',
        montoMensualActual: 0,
        citasIncluidas: 0,
        precioCitaExcedente: 0,
        fechaProximoCobro: new Date('2027-01-01'),
        fechaProximoCobroHosting: new Date('2027-01-01'),
      },
    });

    console.log('Suscripcion PLAN_B creada para empresaId:', empresa.id);
    console.log('suscripcionId:', suscripcion.id);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();