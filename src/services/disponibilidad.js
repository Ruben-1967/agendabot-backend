const prisma = require('../lib/prisma');
const { horaChileAFechaUTC } = require('../lib/horaChile');

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

  // Día de la semana a partir del calendario puro (año/mes/día), sin pasar
  // por ninguna zona horaria — evita cualquier ambigüedad de a qué hora
  // "empieza" el día.
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0=domingo ... 6=sábado

  // 1. Respetar el horizonte de agenda (no agendar demasiado lejos en el futuro)
  const hoy = new Date();
  const inicioDiaChile = horaChileAFechaUTC(fechaISO, '00:00');
  const diasDeDiferencia = Math.floor((inicioDiaChile - hoy) / (1000 * 60 * 60 * 24));
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
  const inicioDia = horaChileAFechaUTC(fechaISO, '00:00');
  const finDia = horaChileAFechaUTC(fechaISO, '23:59');

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
      const horaSlot = minutosAHora(cursor);
      const inicioSlot = horaChileAFechaUTC(fechaISO, horaSlot);
      const finSlot = new Date(inicioSlot.getTime() + duracion * 60000);

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
        slotsDisponibles.push(horaSlot);
      }

      cursor += duracion;
    }
  }

  return slotsDisponibles;
}

/**
 * Suma N días a una fecha ISO ('YYYY-MM-DD') de forma segura, sin pasar por
 * ninguna zona horaria del servidor — pura aritmética de calendario en UTC.
 */
function sumarDiasISO(fechaISO, n) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().split('T')[0];
}

/**
 * Devuelve los próximos días (a partir de hoy, hora Chile) que tengan al
 * menos un horario disponible, hasta juntar `cantidadDias`. Explora como
 * máximo `maxDiasAExplorar` días hacia adelante para no hacer un loop
 * gigante si el negocio tiene muy poca disponibilidad.
 *
 * @returns {Promise<{fecha: string, horas: string[]}[]>}
 */
async function obtenerProximosDiasConDisponibilidad(recursoAgendableId, cantidadDias = 4, maxDiasAExplorar = 30) {
  // 'en-CA' da formato YYYY-MM-DD directo, ya en zona horaria de Chile.
  const hoyChileISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  const diasConCupo = [];

  for (let i = 0; i < maxDiasAExplorar && diasConCupo.length < cantidadDias; i++) {
    const fechaISO = sumarDiasISO(hoyChileISO, i);
    const horas = await obtenerHorariosDisponibles(recursoAgendableId, fechaISO);
    if (horas.length > 0) {
      diasConCupo.push({ fecha: fechaISO, horas });
    }
  }

  return diasConCupo;
}

/**
 * Crea una Cita real en la base de datos.
 */
async function crearCita({ empresaId, clienteId, recursoAgendableId, servicioId, fechaISO, horaInicio }) {
  const recurso = await prisma.recursoAgendable.findUnique({ where: { id: recursoAgendableId } });
  if (!recurso) throw new Error('Recurso no encontrado');

  const fechaHoraInicio = horaChileAFechaUTC(fechaISO, horaInicio);
  const fechaHoraFin = new Date(fechaHoraInicio.getTime() + recurso.duracionCitaMinutos * 60000);

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

module.exports = {
  obtenerHorariosDisponibles,
  crearCita,
  obtenerProximosDiasConDisponibilidad,
};