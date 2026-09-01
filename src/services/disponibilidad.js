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

  // 2. Horario del día: si hay una excepción puntual para esta fecha exacta
  // (negocios con horario variable, ver HorarioExcepcion en schema.prisma),
  // manda ella; si no, la plantilla semanal de siempre.
  const excepcion = await prisma.horarioExcepcion.findUnique({
    where: { recursoAgendableId_fecha: { recursoAgendableId, fecha: fechaISO } },
  });

  const horarios = excepcion
    ? [{ horaInicio: excepcion.horaInicio, horaFin: excepcion.horaFin }]
    : await prisma.horarioSemanal.findMany({
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
async function obtenerProximosDiasConDisponibilidad(recursoAgendableId, cantidadDias = 7, maxDiasAExplorar = 30) {
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
 * Devuelve los slots disponibles de un recurso en un rango de fechas.
 * Alimenta el calendario del panel (CalendarPickerModal).
 *
 * @param {string} recursoAgendableId
 * @param {Date} desde
 * @param {Date} hasta
 * @returns {Promise<{fecha: string, horas: string[]}[]>}
 */
async function obtenerDisponibilidad(recursoAgendableId, desde, hasta) {
  const desdeISO = desde.toISOString().split('T')[0];
  const hastaISO = hasta.toISOString().split('T')[0];

  const dias = [];
  let cursor = desdeISO;

  while (cursor <= hastaISO) {
    const horas = await obtenerHorariosDisponibles(recursoAgendableId, cursor);
    if (horas.length > 0) {
      dias.push({ fecha: cursor, horas });
    }
    cursor = sumarDiasISO(cursor, 1);
  }

  return dias;
}

/**
 * Valida si un slot puntual (fecha + hora) sigue disponible para un recurso.
 *
 * @param {string} recursoAgendableId
 * @param {string} fecha - 'YYYY-MM-DD'
 * @param {string} hora - 'HH:MM'
 * @returns {Promise<boolean>}
 */
async function validarSlot(recursoAgendableId, fecha, hora) {
  const disponibles = await obtenerHorariosDisponibles(recursoAgendableId, fecha);
  return disponibles.includes(hora);
}

/**
 * Devuelve disponibilidad a nivel de SERVICIO (no de un recurso puntual),
 * respetando Servicio.requiereProfesionalEspecifico:
 *
 * - true  -> hay que indicar recursoAgendableId explícito (mismo
 *            comportamiento que obtenerDisponibilidad de siempre).
 * - false -> junta la disponibilidad de TODOS los RecursoAgendable
 *            vinculados en ServicioRecurso, y cada slot indica a qué
 *            recurso corresponde (necesario para poder crear la cita
 *            después, sin volver a preguntar).
 *
 * @param {string} servicioId
 * @param {Date} desde
 * @param {Date} hasta
 * @param {string|null} recursoAgendableId - obligatorio si el servicio requiere profesional específico
 * @returns {Promise<{fecha: string, slots: {hora: string, recursoAgendableId: string}[]}[]>}
 */
async function obtenerDisponibilidadPorServicio(servicioId, desde, hasta, recursoAgendableId = null) {
  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    include: { recursos: { include: { recurso: true } } },
  });
  if (!servicio) throw new Error('Servicio no encontrado');

  if (servicio.requiereProfesionalEspecifico) {
    if (!recursoAgendableId) {
      throw new Error('SERVICIO_REQUIERE_PROFESIONAL_ESPECIFICO');
    }
    const dias = await obtenerDisponibilidad(recursoAgendableId, desde, hasta);
    return dias.map((d) => ({
      fecha: d.fecha,
      slots: d.horas.map((hora) => ({ hora, recursoAgendableId })),
    }));
  }

  const recursosVinculados = servicio.recursos.map((sr) => sr.recurso);
  if (recursosVinculados.length === 0) {
    return []; // servicio marcado como "cualquier profesional" pero sin ninguno vinculado todavía
  }

  const desdeISO = desde.toISOString().split('T')[0];
  const hastaISO = hasta.toISOString().split('T')[0];

  const porFecha = {}; // { 'YYYY-MM-DD': [{hora, recursoAgendableId}, ...] }
  let cursor = desdeISO;
  while (cursor <= hastaISO) {
    porFecha[cursor] = [];
    cursor = sumarDiasISO(cursor, 1);
  }

  for (const recurso of recursosVinculados) {
    const diasDelRecurso = await obtenerDisponibilidad(recurso.id, desde, hasta);
    for (const dia of diasDelRecurso) {
      if (!porFecha[dia.fecha]) continue; // fuera del rango pedido, por seguridad
      for (const hora of dia.horas) {
        porFecha[dia.fecha].push({ hora, recursoAgendableId: recurso.id });
      }
    }
  }

  return Object.keys(porFecha)
    .sort()
    .map((fecha) => ({
      fecha,
      slots: porFecha[fecha].sort((a, b) => a.hora.localeCompare(b.hora)),
    }))
    .filter((d) => d.slots.length > 0);
}

/**
 * Wrapper de obtenerHorariosDisponibles que respeta
 * Servicio.requiereProfesionalEspecifico. Pensado para que el bot de
 * WhatsApp (claude.js) consulte disponibilidad por SERVICIO en vez de por
 * recurso directo, sin tener que decidir él mismo cuál flujo usar.
 *
 * - true  -> exige recursoAgendableId, comportamiento idéntico a hoy.
 * - false -> junta y deduplica las horas libres de TODOS los recursos
 *            vinculados al servicio (no importa cuál profesional quede,
 *            crearCita() resuelve eso después).
 *
 * @param {string} servicioId
 * @param {string} fechaISO - 'YYYY-MM-DD'
 * @param {string|null} recursoAgendableId - obligatorio si el servicio requiere profesional específico
 * @returns {Promise<string[]>}
 */
async function obtenerHorasDisponiblesParaServicio(servicioId, fechaISO, recursoAgendableId = null) {
  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    include: { recursos: true },
  });
  if (!servicio) throw new Error('Servicio no encontrado');

  if (servicio.requiereProfesionalEspecifico) {
    if (!recursoAgendableId) throw new Error('FALTA_RECURSO_AGENDABLE');
    return obtenerHorariosDisponibles(recursoAgendableId, fechaISO);
  }

  const recursosVinculados = servicio.recursos.map((sr) => sr.recursoAgendableId);
  if (recursosVinculados.length === 0) return [];

  const horasSet = new Set();
  for (const rid of recursosVinculados) {
    const horas = await obtenerHorariosDisponibles(rid, fechaISO);
    horas.forEach((h) => horasSet.add(h));
  }
  return Array.from(horasSet).sort();
}

/**
 * Equivalente a obtenerProximosDiasConDisponibilidad, pero por SERVICIO en
 * vez de por recurso directo (mismo criterio que obtenerHorasDisponiblesParaServicio).
 *
 * @returns {Promise<{fecha: string, horas: string[]}[]>}
 */
async function obtenerProximosDiasParaServicio(servicioId, cantidadDias = 7, maxDiasAExplorar = 30, recursoAgendableId = null) {
  const hoyChileISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  const diasConCupo = [];
  for (let i = 0; i < maxDiasAExplorar && diasConCupo.length < cantidadDias; i++) {
    const fechaISO = sumarDiasISO(hoyChileISO, i);
    const horas = await obtenerHorasDisponiblesParaServicio(servicioId, fechaISO, recursoAgendableId);
    if (horas.length > 0) {
      diasConCupo.push({ fecha: fechaISO, horas });
    }
  }
  return diasConCupo;
}

/**
 * Encuentra, entre los recursos vinculados a un servicio "sin profesional
 * específico", el primero que tenga libre una fecha+hora puntual. Se usa
 * en crearCita() para resolver automáticamente qué profesional asignar.
 *
 * @returns {Promise<string|null>} recursoAgendableId disponible, o null si ninguno lo está
 */
async function resolverRecursoDisponible(servicioId, fechaISO, horaInicio) {

  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    include: { recursos: { include: { recurso: true } } },
  });
  if (!servicio) throw new Error('Servicio no encontrado');

  for (const sr of servicio.recursos) {
    const disponibles = await obtenerHorariosDisponibles(sr.recursoAgendableId, fechaISO);
    if (disponibles.includes(horaInicio)) {
      return sr.recursoAgendableId;
    }
  }
  return null;
}

/**
 * Crea una Cita real en la base de datos.
 *
 * recursoAgendableId es opcional: si no se pasa, y el servicio tiene
 * requiereProfesionalEspecifico = false, se resuelve automáticamente al
 * primer profesional vinculado que tenga ese horario libre.
 */

async function crearCita({ empresaId, clienteId, recursoAgendableId = null, servicioId, fechaISO, horaInicio }) {
  if (!recursoAgendableId) {
    if (!servicioId) throw new Error('Falta recursoAgendableId o servicioId');
    const servicio = await prisma.servicio.findUnique({ where: { id: servicioId } });
    if (!servicio) throw new Error('Servicio no encontrado');
    if (servicio.requiereProfesionalEspecifico) {
      throw new Error('FALTA_RECURSO_AGENDABLE');
    }
    recursoAgendableId = await resolverRecursoDisponible(servicioId, fechaISO, horaInicio);
    if (!recursoAgendableId) {
      throw new Error('HORARIO_YA_NO_DISPONIBLE');
    }
  }

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
  obtenerDisponibilidad,
  validarSlot,
  obtenerDisponibilidadPorServicio,
  obtenerHorasDisponiblesParaServicio,
  obtenerProximosDiasParaServicio,
};