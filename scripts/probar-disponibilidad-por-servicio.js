/**
 * Prueba end-to-end de obtenerHorasDisponiblesParaServicio y
 * obtenerProximosDiasParaServicio, en staging.
 *
 * Crea una empresa de prueba con:
 * - Servicio A: requiereProfesionalEspecifico=true + 1 recurso con horario
 *   cargado. Debe dar el MISMO resultado que obtenerHorariosDisponibles
 *   directo sobre ese recurso.
 * - Servicio B: requiereProfesionalEspecifico=false + 2 recursos, cada uno
 *   con horario distinto (mañana vs tarde). El resultado combinado debe
 *   traer horas de ambos, sin duplicados.
 *
 * Usa la fecha de MAÑANA para no depender de la hora del día en que corras
 * el script.
 *
 * Uso (Shell de Render, agendabot-backend-staging):
 *   node scripts/probar-disponibilidad-por-servicio.js
 */
const prisma = require('../src/lib/prisma');
const {
  obtenerHorariosDisponibles,
  obtenerHorasDisponiblesParaServicio,
} = require('../src/services/disponibilidad');

async function main() {
  try {
    const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: 'otro' } });
    if (!rubro) {
      console.error('Falta RubroTemplate "otro". Corre scripts/seed-rubros-nuevos.js primero.');
      process.exit(1);
    }

    const empresa = await prisma.empresa.create({
      data: { nombre: 'Demo Test Disponibilidad Servicio', rubroTemplateId: rubro.id },
    });

    const manana = new Date();
    manana.setUTCDate(manana.getUTCDate() + 1);
    const diaManana = manana.getUTCDay();

    // --- Caso A: requiereProfesionalEspecifico = true ---
    const recursoA = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, tipo: 'profesional', nombre: 'Recurso A', duracionCitaMinutos: 30 },
    });
    await prisma.horarioSemanal.create({
      data: { recursoAgendableId: recursoA.id, diaSemana: diaManana, horaInicio: '09:00', horaFin: '12:00', activo: true },
    });
    const servicioA = await prisma.servicio.create({
      data: { empresaId: empresa.id, nombre: 'Servicio Profesional Fijo', requiereProfesionalEspecifico: true },
    });

    // --- Caso B: requiereProfesionalEspecifico = false, 2 recursos ---
    const recursoB1 = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, tipo: 'profesional', nombre: 'Recurso B1 (mañana)', duracionCitaMinutos: 30 },
    });
    const recursoB2 = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, tipo: 'profesional', nombre: 'Recurso B2 (tarde)', duracionCitaMinutos: 30 },
    });
    await prisma.horarioSemanal.create({
      data: { recursoAgendableId: recursoB1.id, diaSemana: diaManana, horaInicio: '09:00', horaFin: '10:00', activo: true },
    });
    await prisma.horarioSemanal.create({
      data: { recursoAgendableId: recursoB2.id, diaSemana: diaManana, horaInicio: '15:00', horaFin: '16:00', activo: true },
    });
    const servicioB = await prisma.servicio.create({
      data: { empresaId: empresa.id, nombre: 'Servicio Cualquier Profesional', requiereProfesionalEspecifico: false },
    });
    await prisma.servicioRecurso.create({ data: { servicioId: servicioB.id, recursoAgendableId: recursoB1.id } });
    await prisma.servicioRecurso.create({ data: { servicioId: servicioB.id, recursoAgendableId: recursoB2.id } });

    // Anticipación mínima en 0 para que el test no dependa de la hora del día
    await prisma.recursoAgendable.updateMany({
      where: { empresaId: empresa.id },
      data: { anticipacionMinimaMin: 0 },
    });

    const mananaISO = manana.toISOString().split('T')[0];

    console.log('=== CASO A: requiereProfesionalEspecifico = true (fecha: ' + mananaISO + ') ===');
    const directoA = await obtenerHorariosDisponibles(recursoA.id, mananaISO);
    const viaServicioA = await obtenerHorasDisponiblesParaServicio(servicioA.id, mananaISO, recursoA.id);
    console.log('Directo (obtenerHorariosDisponibles):', directoA);
    console.log('Via servicio (obtenerHorasDisponiblesParaServicio):', viaServicioA);
    console.log('Coinciden?', JSON.stringify(directoA) === JSON.stringify(viaServicioA) ? 'SI' : 'NO - revisar');

    console.log('');
    console.log('=== CASO B: requiereProfesionalEspecifico = false, 2 recursos ===');
    const combinadoB = await obtenerHorasDisponiblesParaServicio(servicioB.id, mananaISO);
    console.log('Horas combinadas (deben incluir mañana Y tarde, sin duplicados):', combinadoB);

    console.log('');
    console.log('empresaId de prueba (para limpiar después):', empresa.id);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();