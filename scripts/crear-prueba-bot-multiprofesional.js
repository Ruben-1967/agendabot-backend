/**
 * Crea una empresa de prueba completa para probar /test/chat con el
 * escenario multi-profesional real (bot conversando, no llamado directo
 * a las funciones de disponibilidad).
 *
 * Crea: empresa + 2 RecursoAgendable ("Dra. Ana" mañana, "Dr. Luis" tarde)
 * + 1 Servicio "Consulta General" con requiereProfesionalEspecifico=false
 * vinculado a ambos + Cliente de prueba.
 *
 * Usa la fecha de MAÑANA para los horarios, para no depender de la hora
 * del día en que corras el script.
 *
 * Uso (Shell de Render, agendabot-backend-staging):
 *   node scripts/crear-prueba-bot-multiprofesional.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  try {
    const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: 'otro' } });
    if (!rubro) {
      console.error('Falta RubroTemplate "otro". Corre scripts/seed-rubros-nuevos.js primero.');
      process.exit(1);
    }

    const empresa = await prisma.empresa.create({
      data: {
        nombre: 'Clinica Demo Multiprofesional',
        rubroTemplateId: rubro.id,
        tonoComunicacion: 'Neutral',
      },
    });

    const manana = new Date();
    manana.setUTCDate(manana.getUTCDate() + 1);
    const diaManana = manana.getUTCDay();

    const draAna = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, tipo: 'profesional', nombre: 'Dra. Ana', duracionCitaMinutos: 30, anticipacionMinimaMin: 0 },
    });
    const drLuis = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, tipo: 'profesional', nombre: 'Dr. Luis', duracionCitaMinutos: 30, anticipacionMinimaMin: 0 },
    });
    await prisma.horarioSemanal.create({
      data: { recursoAgendableId: draAna.id, diaSemana: diaManana, horaInicio: '09:00', horaFin: '11:00', activo: true },
    });
    await prisma.horarioSemanal.create({
      data: { recursoAgendableId: drLuis.id, diaSemana: diaManana, horaInicio: '15:00', horaFin: '17:00', activo: true },
    });

    const servicio = await prisma.servicio.create({
      data: { empresaId: empresa.id, nombre: 'Consulta General', requiereProfesionalEspecifico: false },
    });
    await prisma.servicioRecurso.create({ data: { servicioId: servicio.id, recursoAgendableId: draAna.id } });
    await prisma.servicioRecurso.create({ data: { servicioId: servicio.id, recursoAgendableId: drLuis.id } });

    const cliente = await prisma.cliente.create({
      data: { empresaId: empresa.id, nombre: 'Cliente Prueba Bot', telefono: '56900000001' },
    });

    console.log('Empresa creada:', empresa.id);
    console.log('Servicio "Consulta General" (sin profesional fijo):', servicio.id);
    console.log('Dra. Ana (09:00-11:00 manana):', draAna.id);
    console.log('Dr. Luis (15:00-17:00 manana):', drLuis.id);
    console.log('Cliente de prueba, telefono:', cliente.telefono);
    console.log('');
    console.log('Fecha de manana (para el mensaje de prueba):', manana.toISOString().split('T')[0]);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();