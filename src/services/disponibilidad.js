const prisma = require('../lib/prisma');

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
function horaAMinutos(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Calcula los horarios disponibles para un RecursoAgendable en una fecha específica.
 *
 * @param {string} recursoAgendableId
 * @param {string} fechaISO - Fecha en formato 'YYYY-MM-DD' (zona horaria del negocio, asumimos Chile).
 * @returns {Promise<string[]>} Lista de horas de inicio disponibles, ej. ['10:00', '10:30', ...].
 */
async function obtenerHorariosDisponibles(recursoAgendableId, fechaISO) {
  const recurso = await prisma.recursoAgendable.findUnique({
    where: { id: recursoAgendableId },
  });

  if (!recurso) {
    throw new Error(`RecursoAgendable ${recursoAgendableId} no existe`);
  }

  const fecha = new Date(`${fechaISO}T00:00:00`);
  const diaSemana = fecha.getDay(); // 0=domingo ... 6=sábado

  // 1. Respetar el horizonte de agenda (no agendar demasiado lejos en el futuro)
  const hoy = new Date();
  const diasDeDiferencia = Math.floor((fecha - hoy) / (1000 * 60 * 60 * 24));
  if (diasDeDiferencia > recurso.horizonteAgendaDias) {
    return [];
  }

  // 2. Traer los bloques de horario semanal activos para ese día
  const horarios = await prisma.horarioSemanal.findMany({
    where: { recursoAgendableId, diaSemana, activo: true },
  });

  if (horarios.length === 0) {
    return []; // el negocio no atiende ese día de la semana
  }

  // 3. Traer bloqueos (vacaciones, feriados puntuales) que se crucen con ese día
  const inicioDia = new Date(`${fechaISO}T00:00:00`);
  const finDia = new Date(`${fechaISO}T23:59:59`);

  const bloqueos = await prisma.bloqueo.findMany({
    where: {
      recursoAgendableId,
      fechaInicio: { lte: finDia },
      fechaFin: { gte: inicioDia },
    },
  });

  // 4. Traer citas ya agendadas ese día (que no estén canceladas)
  const citasExistentes = await prisma.cita.findMany({
    where: {
      recursoAgendableId,
      fechaHoraInicio: { gte: inicioDia, lte: finDia },
      estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
    },
  });

  const duracion = recurso.duracionCitaMinutos;
  const slotsDisponibles = [];

  for (const bloque of horarios) {
    let cursor = horaAMinutos(bloque.horaInicio);
    const finBloque = horaAMinutos(bloque.horaFin);

    while (cursor + duracion <= finBloque) {
      const inicioSlot = new Date(fecha);
      inicioSlot.setMinutes(inicioSlot.getMinutes() + cursor);
      const finSlot = new Date(inicioSlot);
      finSlot.setMinutes(finSlot.getMinutes() + duracion);

      // Respetar anticipación mínima (no ofrecer horas demasiado cercanas a "ahora")
      const minutosHastaSlot = (inicioSlot - hoy) / (1000 * 60);
      const cumpleAnticipacion = minutosHastaSlot >= recurso.anticipacionMinimaMin;

      // Verificar que no se cruce con un bloqueo
      const chocaConBloqueo = bloqueos.some(
        (b) => inicioSlot < b.fechaFin && finSlot > b.fechaInicio
      );

      // Verificar que no se cruce con una cita ya tomada
      const chocaConCita = citasExistentes.some(
        (c) => inicioSlot < c.fechaHoraFin && finSlot > c.fechaHoraInicio
      );

      if (cumpleAnticipacion && !chocaConBloqueo && !chocaConCita) {
        slotsDisponibles.push(minutosAHora(cursor));
      }

      cursor += duracion;
    }
  }

  return slotsDisponibles;
}

/**
 * Crea una Cita real en la base de datos.
 */
async function crearCita({ empresaId, clienteId, recursoAgendableId, servicioId, fechaISO, horaInicio }) {
  const recurso = await prisma.recursoAgendable.findUnique({ where: { id: recursoAgendableId } });
  if (!recurso) throw new Error('Recurso no encontrado');

  const fechaHoraInicio = new Date(`${fechaISO}T${horaInicio}:00`);
  const fechaHoraFin = new Date(fechaHoraInicio);
  fechaHoraFin.setMinutes(fechaHoraFin.getMinutes() + recurso.duracionCitaMinutos);

  // Revalidamos disponibilidad justo antes de crear, para evitar condiciones de carrera
  // (dos clientes pidiendo el mismo horario casi al mismo tiempo).
  const disponibles = await obtenerHorariosDisponibles(recursoAgendableId, fechaISO);
  if (!disponibles.includes(horaInicio)) {
    throw new Error('HORARIO_YA_NO_DISPONIBLE');
  }

  return prisma.cita.create({
    data: {
      empresaId,
      clienteId,
      recursoAgendableId,
      servicioId,
      fechaHoraInicio,
      fechaHoraFin,
      estado: 'PENDIENTE',
      origenCanal: 'whatsapp',
    },
  });
}

module.exports = { obtenerHorariosDisponibles, crearCita };
