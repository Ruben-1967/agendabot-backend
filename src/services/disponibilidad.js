const prisma = require('../lib/prisma');
const { horaChileAFechaUTC } = require('../lib/horaChile');
const { normalizarRut, esRutValido } = require('../lib/rut');
const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');

/**
 * Convierte "HH:MM" a minutos desde medianoche.
 */
function horaAMinutos(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Nombre del EXCLUDE constraint de Postgres que impide 2 Cita PENDIENTE/
// CONFIRMADA solapadas para el mismo recurso (ver
// scripts/_migracion-exclude-constraint-doble-reserva.js). Cualquier
// INSERT o UPDATE sobre Cita que pueda generar un solapamiento (crear,
// reagendar, o reactivar una CANCELADA de vuelta a PENDIENTE/CONFIRMADA)
// puede chocar contra este constraint -- usar esConflictoDeHorario(err)
// para detectarlo de forma consistente en vez de repetir el string-match
// en cada lugar. Prisma no expone un código de error conocido para esto
// (no es P2002): es un PrismaClientUnknownRequestError con err.code
// undefined, así que se detecta por el nombre del constraint en el
// mensaje crudo de Postgres.
const NOMBRE_CONSTRAINT_DOBLE_RESERVA = 'cita_no_solapa_horario';
function esConflictoDeHorario(err) {
  return typeof err.message === 'string' && err.message.includes(NOMBRE_CONSTRAINT_DOBLE_RESERVA);
}

function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Bloques de horario (horaInicio/horaFin) que rigen un recurso en una fecha
 * exacta: si hay una HorarioExcepcion para esa fecha puntual (negocios con
 * horario variable), manda ella; si no, la plantilla semanal de siempre.
 *
 * Punto único de esta decisión — cualquier lugar del código que necesite
 * saber "¿qué horario tiene este recurso hoy?" debe llamar a esta función
 * en vez de consultar HorarioSemanal directo, para no quedar desincronizado
 * si más adelante cambia cómo se resuelve el horario del día (ya pasó una
 * vez: GET /agenda/citas tenía su propia copia de esta lógica y quedó sin
 * enterarse de HorarioExcepcion cuando se agregó).
 *
 * @param {string} recursoAgendableId
 * @param {string} fechaISO - 'YYYY-MM-DD'
 * @param {number} diaSemana - 0=domingo...6=sábado, ya calculado por quien llama
 * @returns {Promise<{horaInicio: string, horaFin: string}[]>}
 */
async function obtenerHorarioDelDia(recursoAgendableId, fechaISO, diaSemana) {
  const excepcion = await prisma.horarioExcepcion.findUnique({
    where: { recursoAgendableId_fecha: { recursoAgendableId, fecha: fechaISO } },
  });

  if (excepcion) {
    return [{ horaInicio: excepcion.horaInicio, horaFin: excepcion.horaFin }];
  }

  return prisma.horarioSemanal.findMany({
    where: { recursoAgendableId, diaSemana, activo: true },
  });
}

/**
 * Calcula los horarios disponibles para un RecursoAgendable en una fecha específica.
 *
 * @param {string} recursoAgendableId
 * @param {string} fechaISO - Fecha en formato 'YYYY-MM-DD' (zona horaria del negocio, asumimos Chile).
 * @returns {Promise<string[]>} Lista de horas de inicio disponibles, ej. ['10:00', '10:30', ...].
 */
async function obtenerHorariosDisponibles(recursoAgendableId, fechaISO) {
  const bloques = await obtenerHorariosDisponiblesPorBloque(recursoAgendableId, fechaISO);
  return bloques.flatMap((b) => b.horas);
}

/**
 * Igual que obtenerHorariosDisponibles, pero sin aplanar el resultado —
 * agrupa las horas reales por cada bloque de horario configurado
 * (HorarioSemanal puede tener varias filas para el mismo día, ej. un
 * bloque de mañana y otro de tarde separados por un break). Bloques sin
 * ninguna hora disponible se omiten del resultado. Usado para poder
 * mandar un mensaje de WhatsApp por bloque (ej. "Mañana"/"Tarde") en vez
 * de un solo texto largo — pedido por Ahorróptica 2026-09-03, agenda de
 * citas cada 15 min genera demasiadas horas para un solo mensaje/lista.
 *
 * @returns {Promise<{horaInicio: string, horaFin: string, horas: string[]}[]>}
 */
async function obtenerHorariosDisponiblesPorBloque(recursoAgendableId, fechaISO) {
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

  // 2. Horario del día (excepción puntual si existe, si no la plantilla semanal)
  const horarios = await obtenerHorarioDelDia(recursoAgendableId, fechaISO, diaSemana);

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
  const bloquesConHoras = [];

  for (const bloque of horarios) {
    const horasDelBloque = [];
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
        horasDelBloque.push(horaSlot);
      }

      cursor += duracion;
    }

    if (horasDelBloque.length > 0) {
      bloquesConHoras.push({ horaInicio: bloque.horaInicio, horaFin: bloque.horaFin, horas: horasDelBloque });
    }
  }

  return bloquesConHoras;
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
 * Igual que obtenerHorasDisponiblesParaServicio, pero agrupada por bloque
 * (ver obtenerHorariosDisponiblesPorBloque). Cuando el servicio SÍ exige un
 * profesional puntual, refleja los bloques reales de su horario (con
 * break, si lo tiene). Cuando NO (varios recursos posibles), no hay un
 * único horario real que mostrar por bloque — se combinan todas las horas
 * en un solo bloque ordenado, igual que ya hacía la versión plana.
 *
 * @returns {Promise<{horaInicio: string, horaFin: string, horas: string[]}[]>}
 */
async function obtenerHorasDisponiblesPorBloqueParaServicio(servicioId, fechaISO, recursoAgendableId = null) {
  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    include: { recursos: true },
  });
  if (!servicio) throw new Error('Servicio no encontrado');

  if (servicio.requiereProfesionalEspecifico) {
    if (!recursoAgendableId) throw new Error('FALTA_RECURSO_AGENDABLE');
    return obtenerHorariosDisponiblesPorBloque(recursoAgendableId, fechaISO);
  }

  const recursosVinculados = servicio.recursos.map((sr) => sr.recursoAgendableId);
  if (recursosVinculados.length === 0) return [];

  const horasSet = new Set();
  for (const rid of recursosVinculados) {
    const horas = await obtenerHorariosDisponibles(rid, fechaISO);
    horas.forEach((h) => horasSet.add(h));
  }
  const horasOrdenadas = Array.from(horasSet).sort();
  if (horasOrdenadas.length === 0) return [];
  return [{ horaInicio: horasOrdenadas[0], horaFin: horasOrdenadas[horasOrdenadas.length - 1], horas: horasOrdenadas }];
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

  // Revalidamos disponibilidad justo antes de crear -- esto es solo UX (falla
  // rápido, sin ida y vuelta a la base para el caso común), NO evita la
  // condición de carrera real (dos clientes pidiendo el mismo horario casi
  // al mismo tiempo pueden ambos pasar este check antes de que el otro
  // complete su INSERT). La garantía real de integridad es el constraint
  // "cita_no_solapa_horario" de Postgres (EXCLUDE USING gist, creado con
  // scripts/_migracion-exclude-constraint-doble-reserva.js -- fuera del
  // schema.prisma porque Prisma no soporta EXCLUDE constraints de forma
  // declarativa; confirmado que "prisma db push" no lo toca ni lo borra, ni
  // siquiera lo detecta) -- Postgres rechaza el INSERT a nivel de motor si
  // se solapa con otra Cita PENDIENTE o
  // CONFIRMADA del mismo recurso, sin importar si la petición viene de acá,
  // de un job, o de una edición futura desde el panel. 2026-09-15: se
  // encontraron 68 pares de citas ya solapadas en Staging (data de
  // demo/seed, limpiada con scripts/_limpieza-citas-solapadas-staging.js)
  // antes de poder crear el constraint -- confirma que el check-then-act de
  // abajo, solo, no bastaba.
  const disponibles = await obtenerHorariosDisponibles(recursoAgendableId, fechaISO);
  if (!disponibles.includes(horaInicio)) {
    throw new Error('HORARIO_YA_NO_DISPONIBLE');
  }

  try {
    return await prisma.cita.create({
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
  } catch (err) {
    // El caso real de carrera que el check de arriba no alcanza a atrapar.
    if (esConflictoDeHorario(err)) {
      throw new Error('HORARIO_YA_NO_DISPONIBLE');
    }
    throw err;
  }
}

/**
 * Sin esto, un "rut" mal extraído (texto libre, un id, lo que sea) se
 * guardaba tal cual en Cliente.rut -- visto en producción como un string
 * larguísimo en la columna Rut del panel. Movido desde claude.js junto con
 * crearCitaValidada (ver más abajo), único lugar que lo usa.
 */
function normalizarYValidarRut(rutCrudo) {
  const normalizado = normalizarRut(rutCrudo);
  return esRutValido(normalizado) ? normalizado : null;
}

/**
 * Dado el nombre de servicio, decide si el flujo de disponibilidad/
 * agendamiento debe usar el recurso fijo de la empresa (comportamiento de
 * siempre) o el modo "cualquier profesional vinculado" (multi-profesional,
 * OPCIÓN C). Si el nombre no calza con ningún Servicio real (empresa sin
 * servicios cargados, o typo), cae al comportamiento de siempre usando el
 * recurso fijo.
 *
 * @returns {Promise<{servicioDb: Object|null, usaProfesionalFijo: boolean, recursoId: string|null}>}
 */
async function resolverServicioParaHerramienta(empresa, recurso, nombreServicio) {
  const servicioDb = nombreServicio
    ? await prisma.servicio.findFirst({
        where: { empresaId: empresa.id, nombre: { equals: nombreServicio, mode: 'insensitive' } },
      })
    : null;
  return _resolverDesdeServicioDb(servicioDb, recurso);
}

/**
 * Igual que resolverServicioParaHerramienta, pero resolviendo por id exacto
 * en vez de nombre -- usado por el camino de tap determinístico (ver
 * chatbotEngine.js), donde el backend ya conoce el servicioId con certeza
 * (viene decodificado del botón, no de texto libre que Claude interpretó).
 *
 * @returns {Promise<{servicioDb: Object|null, usaProfesionalFijo: boolean, recursoId: string|null}>}
 */
async function resolverServicioParaHerramientaPorId(empresa, recurso, servicioId) {
  const servicioDb = servicioId
    ? await prisma.servicio.findFirst({ where: { id: servicioId, empresaId: empresa.id } })
    : null;
  return _resolverDesdeServicioDb(servicioDb, recurso);
}

function _resolverDesdeServicioDb(servicioDb, recurso) {
  if (!servicioDb || servicioDb.requiereProfesionalEspecifico) {
    return { servicioDb, usaProfesionalFijo: true, recursoId: recurso?.id || null };
  }
  return { servicioDb, usaProfesionalFijo: false, recursoId: null };
}

/**
 * Valida los datos reunidos de una reserva y crea la Cita real -- extraído
 * del bloque `agendar_cita` de claude.js (2026-09-17, fix estructural) para
 * que tanto el camino agéntico (Claude llamando a la tool, mientras siga
 * existiendo) como el camino determinístico de tap
 * (chatbotEngine.js#procesarSeleccionInteractiva) compartan exactamente la
 * misma validación -- nunca dos copias que puedan desincronizarse. Mutea
 * Cliente.nombre/rut/telefono si cambiaron, igual que hacía el bloque
 * original.
 *
 * @param {Object} datos - {servicioNombre?, servicioId?, fecha, hora, nombre, rut?, telefono?} -- pasar servicioId cuando ya se conoce con certeza (tap), servicioNombre cuando viene de un tool call de Claude.
 * @param {Object} contexto - {empresa, cliente, recurso}
 * @returns {Promise<{exito: true, citaId: string, fecha: string, fechaLegible: string, hora: string, servicioNombre: string|null}|{exito: false, error: string}>}
 */
async function crearCitaValidada(datos, contexto) {
  const { empresa, cliente, recurso } = contexto;

  const resuelto = datos.servicioId
    ? await resolverServicioParaHerramientaPorId(empresa, recurso, datos.servicioId)
    : await resolverServicioParaHerramienta(empresa, recurso, datos.servicioNombre);

  if (resuelto.usaProfesionalFijo && !resuelto.recursoId) {
    return { exito: false, error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
  }

  // Resguardo: nunca asumir el nombre de perfil de WhatsApp del contacto
  // (quien escribe no siempre es quien se atiende, ej. agenda para un
  // familiar) -- ver instrucción equivalente en el system prompt de
  // claude.js para el camino agéntico.
  if (!datos.nombre) {
    return { exito: false, error: 'Falta el nombre completo de quien se va a atender. Pídeselo explícitamente antes de reintentar — no asumas el nombre de perfil de WhatsApp.' };
  }
  if (cliente.nombre !== datos.nombre) {
    await prisma.cliente.update({ where: { id: cliente.id }, data: { nombre: datos.nombre } });
  }

  if (empresa.requiereRut) {
    if (!datos.rut) {
      return { exito: false, error: 'Este negocio exige RUT para agendar. Pide el RUT del cliente antes de reintentar.' };
    }
    if (!datos.telefono) {
      return { exito: false, error: 'Este negocio exige un teléfono de contacto para agendar. Pídeselo explícitamente antes de reintentar.' };
    }
    const rutValidado = normalizarYValidarRut(datos.rut);
    if (!rutValidado) {
      return { exito: false, error: `"${datos.rut}" no tiene formato de RUT chileno válido (ej. 12345678-9). Pídeselo de nuevo al cliente antes de reintentar.` };
    }
    if (cliente.rut !== rutValidado || cliente.telefono !== datos.telefono) {
      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { rut: rutValidado, telefono: datos.telefono },
      });
    }
  }

  try {
    const cita = await crearCita({
      empresaId: empresa.id,
      clienteId: cliente.id,
      recursoAgendableId: resuelto.usaProfesionalFijo ? resuelto.recursoId : null,
      servicioId: resuelto.servicioDb?.id || null,
      fechaISO: datos.fecha,
      horaInicio: datos.hora,
    });
    // fechaLegible (en español, con día de la semana correcto) para que la
    // confirmación final la reutilice tal cual en vez de calcular ella
    // misma el día de semana a partir del ISO.
    return {
      exito: true,
      citaId: cita.id,
      fecha: datos.fecha,
      fechaLegible: fechaLegibleDesdeISO(datos.fecha),
      hora: datos.hora,
      servicioNombre: resuelto.servicioDb?.nombre || datos.servicioNombre || null,
    };
  } catch (err) {
    if (err.message === 'HORARIO_YA_NO_DISPONIBLE') {
      return { exito: false, error: 'Ese horario ya no está disponible, ofrece otra alternativa.' };
    }
    throw err;
  }
}

module.exports = {
  obtenerHorarioDelDia,
  obtenerHorariosDisponibles,
  obtenerHorariosDisponiblesPorBloque,
  crearCita,
  esConflictoDeHorario,
  obtenerProximosDiasConDisponibilidad,
  obtenerDisponibilidad,
  validarSlot,
  obtenerDisponibilidadPorServicio,
  obtenerHorasDisponiblesParaServicio,
  obtenerHorasDisponiblesPorBloqueParaServicio,
  obtenerProximosDiasParaServicio,
  resolverServicioParaHerramienta,
  resolverServicioParaHerramientaPorId,
  crearCitaValidada,
  normalizarYValidarRut,
};
