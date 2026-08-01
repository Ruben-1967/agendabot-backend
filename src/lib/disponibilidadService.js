/**
 * disponibilidadService.js
 * 
 * Calcula disponibilidad de slots para agendamiento considerando:
 * - Horarios semanales (HorarioSemanal)
 * - Bloqueos de recurso (Bloqueo)
 * - Bloqueos de profesional (BloqueoProfesional)
 * - Citas existentes
 * 
 * Soporta OPCIÓN C: recursosAgendables genéricos (profesionalId=null) 
 * y específicos (profesionalId=string)
 */

const prisma = require('./prisma');
const { horaChileAFechaUTC, calcularOffsetChile } = require('./horaChile');

/**
 * Obtiene slots disponibles para un recurso en un rango de fechas
 * 
 * @param {string} recursoAgendableId - ID del recurso (profesional o sala)
 * @param {Date} fechaDesde - Fecha inicio (default: hoy)
 * @param {Date} fechaHasta - Fecha fin (default: hoy + 30 días)
 * @returns {Promise<Array>} Array de {fecha, hora, disponiblePara}
 */
async function obtenerDisponibilidad(
  recursoAgendableId,
  fechaDesde = new Date(),
  fechaHasta = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
) {
  try {
    // Obtener recurso
    const recurso = await prisma.recursoAgendable.findUnique({
      where: { id: recursoAgendableId },
      include: {
        horarios: true,
        bloqueos: true,
        empresa: true,
        profesional: true,
      },
    });

    if (!recurso) {
      throw new Error(`Recurso ${recursoAgendableId} no encontrado`);
    }

    // Obtener profesionales disponibles
    let profesionalesIds = [];
    if (recurso.profesionalId) {
      // Recurso específico: solo este profesional
      profesionalesIds = [recurso.profesionalId];
    } else {
      // Recurso genérico: todos los profesionales activos de la empresa
      const profesionales = await prisma.profesional.findMany({
        where: {
          empresaId: recurso.empresaId,
          activo: true,
        },
        select: { id: true },
      });
      profesionalesIds = profesionales.map((p) => p.id);
    }

    // Obtener bloqueos de profesional en el rango
    const bloqueosProfesionales = await prisma.bloqueoProfesional.findMany({
      where: {
        empresaId: recurso.empresaId,
        profesionalId: { in: profesionalesIds },
        fechaFin: { gte: fechaDesde },
        fechaInicio: { lte: fechaHasta },
      },
    });

    // Obtener citas existentes en el rango
    const citasExistentes = await prisma.cita.findMany({
      where: {
        recursoAgendableId,
        fechaHoraInicio: { gte: fechaDesde, lte: fechaHasta },
        estado: { not: 'CANCELADA' },
      },
    });

    // Generar slots
    const slots = generarSlots(
      recurso,
      fechaDesde,
      fechaHasta,
      profesionalesIds,
      bloqueosProfesionales,
      citasExistentes
    );

    return slots;
  } catch (error) {
    console.error('Error en obtenerDisponibilidad:', error);
    throw error;
  }
}

/**
 * Genera array de slots disponibles
 * 
 * @private
 */
function generarSlots(
  recurso,
  fechaDesde,
  fechaHasta,
  profesionalesIds,
  bloqueosProfesionales,
  citasExistentes
) {
  const slots = [];
  const duracionMinutos = recurso.duracionCitaMinutos || 30;
  
  // Iterar cada día en el rango
  let fecha = new Date(fechaDesde);
  fecha.setHours(0, 0, 0, 0);

  while (fecha <= fechaHasta) {
    const diaSemana = fecha.getDay();
    
    // Obtener horarios para este día de la semana
    const horariosDelDia = recurso.horarios.filter(
      (h) => h.diaSemana === diaSemana && h.activo
    );

    if (horariosDelDia.length > 0) {
      // Verificar si el recurso está bloqueado ese día
      const recursoEstaBloqueado = recurso.bloqueos.some(
        (b) => {
          const bloqueoDe = new Date(b.fechaInicio);
          const bloqueHasta = new Date(b.fechaFin);
          bloqueoDe.setHours(0, 0, 0, 0);
          bloqueHasta.setHours(23, 59, 59, 999);
          return fecha >= bloqueoDe && fecha <= bloqueHasta;
        }
      );

      if (!recursoEstaBloqueado) {
        // Generar slots en este horario
        horariosDelDia.forEach((horario) => {
          const slotsDelHorario = generarSlotsDelHorario(
            fecha,
            horario.horaInicio,
            horario.horaFin,
            duracionMinutos,
            profesionalesIds,
            bloqueosProfesionales,
            citasExistentes
          );
          slots.push(...slotsDelHorario);
        });
      }
    }

    // Siguiente día
    fecha.setDate(fecha.getDate() + 1);
  }

  return slots;
}

/**
 * Genera slots dentro de un horario específico (ej. 09:00-13:00)
 * 
 * @private
 */
function generarSlotsDelHorario(
  fecha,
  horaInicio,
  horaFin,
  duracionMinutos,
  profesionalesIds,
  bloqueosProfesionales,
  citasExistentes
) {
  const slotsDelHorario = [];

  // Parsear horaInicio y horaFin
  const [inicioHora, inicioMin] = horaInicio.split(':').map(Number);
  const [finHora, finMin] = horaFin.split(':').map(Number);

  // Crear timestamps
  const horaInicioDate = new Date(fecha);
  horaInicioDate.setHours(inicioHora, inicioMin, 0, 0);

  const horaFinDate = new Date(fecha);
  horaFinDate.setHours(finHora, finMin, 0, 0);

  // Generar slots cada duracionMinutos
  let horaActual = new Date(horaInicioDate);

  while (horaActual.getTime() + duracionMinutos * 60 * 1000 <= horaFinDate.getTime()) {
    const horaSlot = horaActual.getHours().toString().padStart(2, '0');
    const minSlot = horaActual.getMinutes().toString().padStart(2, '0');
    const horaFormato = `${horaSlot}:${minSlot}`;

    // Verificar qué profesionales están disponibles en este slot
    const disponiblePara = profesionalesIds.filter((profId) => {
      // Verificar bloqueos del profesional
      const profesionalBloqueado = bloqueosProfesionales.some((bloqueo) => {
        const bloqueoDe = new Date(bloqueo.fechaInicio);
        const bloqueHasta = new Date(bloqueo.fechaFin);
        return (
          bloqueo.profesionalId === profId &&
          horaActual >= bloqueoDe &&
          horaActual <= bloqueHasta
        );
      });

      if (profesionalBloqueado) return false;

      // Verificar citas existentes
      const citaConflicto = citasExistentes.some((cita) => {
        if (cita.profesionalAsignadoId && cita.profesionalAsignadoId !== profId) {
          return false;
        }
        
        const citaInicio = new Date(cita.fechaHoraInicio);
        const citaFin = new Date(cita.fechaHoraFin);
        const slotFin = new Date(horaActual.getTime() + duracionMinutos * 60 * 1000);

        return horaActual < citaFin && slotFin > citaInicio;
      });

      return !citaConflicto;
    });

    if (disponiblePara.length > 0) {
      slotsDelHorario.push({
        fecha: fecha.toISOString().split('T')[0],
        hora: horaFormato,
        disponiblePara,
      });
    }

    horaActual.setMinutes(horaActual.getMinutes() + duracionMinutos);
  }

  return slotsDelHorario;
}

/**
 * Valida si un slot específico sigue siendo disponible
 */
async function validarSlot(recursoAgendableId, fecha, hora, profesionalId = null) {
  try {
    const recurso = await prisma.recursoAgendable.findUnique({
      where: { id: recursoAgendableId },
      include: { horarios: true, bloqueos: true },
    });

    if (!recurso) throw new Error('Recurso no encontrado');

    const [horaNum, minNum] = hora.split(':').map(Number);
    const fechaDate = new Date(fecha);
    fechaDate.setHours(horaNum, minNum, 0, 0);

    const profIdAValidar = recurso.profesionalId || profesionalId;
    if (!profIdAValidar) throw new Error('No hay profesional especificado');

    const bloqueoProfesional = await prisma.bloqueoProfesional.findFirst({
      where: {
        profesionalId: profIdAValidar,
        fechaInicio: { lte: fechaDate },
        fechaFin: { gte: fechaDate },
      },
    });

    if (bloqueoProfesional) return false;

    const duracionMinutos = recurso.duracionCitaMinutos || 30;
    const fechaFin = new Date(fechaDate.getTime() + duracionMinutos * 60 * 1000);

    const citaConflicto = await prisma.cita.findFirst({
      where: {
        recursoAgendableId,
        estado: { not: 'CANCELADA' },
        fechaHoraInicio: { lt: fechaFin },
        fechaHoraFin: { gt: fechaDate },
      },
    });

    return !citaConflicto;
  } catch (error) {
    console.error('Error validando slot:', error);
    throw error;
  }
}

module.exports = {
  obtenerDisponibilidad,
  validarSlot,
};