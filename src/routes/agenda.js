// src/routes/agenda.js
//
// Panel de "Agenda / Horario / Bloqueos" — reemplaza la carga manual por
// script (ver scripts/cargar-agendamiento-ahoroptica.js, que sigue
// existiendo solo como referencia/respaldo de emergencia) por un panel
// real donde el propio negocio configura su horario de atención y sus
// bloqueos (vacaciones, feriados puntuales, etc.).
//
// Asume UN solo RecursoAgendable por empresa (misma simplificación ya
// documentada en src/services/claude.js). Si más adelante una empresa
// necesita varios profesionales/boxes en paralelo, este archivo es el
// punto a extender primero.
//
// GET    /agenda                  -> recurso (con horarios y bloqueos) + servicios
// GET    /agenda/dashboard/:empresaId -> resumen de citas del día + agenda
// PUT    /agenda/recurso           -> crea o actualiza el RecursoAgendable base
// PUT    /agenda/horarios          -> reemplaza el horario semanal completo
// POST   /agenda/bloqueos          -> crea un bloqueo (vacaciones, feriado, etc.)
// DELETE /agenda/bloqueos/:id      -> elimina un bloqueo

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { horaChileAFechaUTC } = require('../lib/horaChile');

const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function horaAMinutos(horaStr) {
  const h = parseInt(horaStr.split(':')[0], 10);
  const m = parseInt(horaStr.split(':')[1], 10);
  return h * 60 + m;
}

router.use(requireAuth);

// ------------------------------------------------------------
// GET /agenda — todo lo que necesita la pantalla de configuración en
// una sola llamada: recurso + horarios + bloqueos + servicios.
// ------------------------------------------------------------
router.get('/', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const recurso = await prisma.recursoAgendable.findFirst({
      where: { empresaId },
      include: {
        horarios: { orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] },
        bloqueos: { orderBy: { fechaInicio: 'asc' } },
      },
    });

    const servicios = await prisma.servicio.findMany({
      where: { empresaId },
      orderBy: { nombre: 'asc' },
    });

    res.json({ recurso, servicios });
  } catch (error) {
    console.error('Error en GET /agenda:', error);
    res.status(500).json({ error: 'Error al obtener la configuración de agenda' });
  }
});

// ------------------------------------------------------------
// GET /agenda/dashboard/:empresaId — resumen de citas del día
// (citasHoy, confirmadas, listaEspera, asistencia 30 días) + detalle
// de agenda del día completo con cards colapsables.
// ------------------------------------------------------------
router.get('/dashboard/:empresaId', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const { empresaId } = req.params;

    // Validar que el usuario pertenece a esta empresa
    if (req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

// Calcular "hoy" en zona horaria Chile usando formatToParts (sin asumir orden)
const ahora = new Date();
const formatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const parts = formatter.formatToParts(ahora);
const year = parts.find(p => p.type === 'year').value;
const month = parts.find(p => p.type === 'month').value;
const day = parts.find(p => p.type === 'day').value;

const hoyChileISO = `${year}-${month}-${day}`;
const hoyChile = horaChileAFechaUTC(hoyChileISO, '00:00');
const mañanaChile = horaChileAFechaUTC(hoyChileISO, '23:59');

    // 1. CITAS HOY (todas las del día, sin filtrar por estado)
    const citasHoy = await prisma.cita.count({
      where: {
        empresaId,
        fechaHoraInicio: {
          gte: hoyChile,
          lt: mañanaChile,
        },
      },
    });

    // 2. CONFIRMADAS (solo CONFIRMADA hoy)
    const confirmadas = await prisma.cita.count({
      where: {
        empresaId,
        estado: 'CONFIRMADA',
        fechaHoraInicio: {
          gte: hoyChile,
          lt: mañanaChile,
        },
      },
    });

    // 3. LISTA DE ESPERA
    const listaEspera = await prisma.listaEspera.count({
      where: {
        empresaId,
        estado: 'ESPERANDO',
      },
    });

    // 4. ASISTENCIA ÚLTIMOS 30 DÍAS
    const hace30Dias = new Date(hoyChile.getTime() - 30 * 24 * 60 * 60 * 1000);
    const completadas = await prisma.cita.count({
      where: {
        empresaId,
        estado: 'COMPLETADA',
        fechaHoraInicio: {
          gte: hace30Dias,
          lt: mañanaChile,
        },
      },
    });
    const noAsistio = await prisma.cita.count({
      where: {
        empresaId,
        estado: 'NO_ASISTIO',
        fechaHoraInicio: {
          gte: hace30Dias,
          lt: mañanaChile,
        },
      },
    });
    const asistencia30dias = completadas + noAsistio > 0
      ? Math.round((completadas / (completadas + noAsistio)) * 100)
      : 0;

   // 5. AGENDA DEL DÍA (detalle completo)
const agendaHoy = await prisma.cita.findMany({
  where: {
    empresaId,
    fechaHoraInicio: {
      gte: hoyChile,
      lt: mañanaChile,
    },
  },
  include: {
    cliente: {
      select: {
        id: true,
        nombre: true,
        telefono: true,
        fichaJson: true,
      },
    },
    servicio: true,
    recurso: true,
  },
  orderBy: {
    fechaHoraInicio: 'asc',
  },
});

    // Formatear agenda con horas en Chile
    const agendaFormato = agendaHoy.map((cita) => {
      const formatterHora = new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const hora = formatterHora.format(cita.fechaHoraInicio);

      return {
        id: cita.id,
        hora,
        nombre: cita.cliente?.nombre || 'Sin asignar',
        servicio: cita.servicio?.nombre || 'Sin especificar',
        profesional: cita.recurso?.nombre || 'Sin asignar',
        estado: cita.estado,
        telefono: cita.cliente?.telefono || null,
        rut: cita.cliente?.rut || null,
        notas: null,
      };
    });

    res.json({
      citasHoy,
      confirmadas,
      listaEspera,
      asistencia30dias,
      agendaHoy: agendaFormato,
    });
  } catch (error) {
    console.error('Error en GET /agenda/dashboard/:empresaId:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ------------------------------------------------------------
// PUT /agenda/recurso — crea el RecursoAgendable si la empresa todavía
// no tiene ninguno, o actualiza sus parámetros base si ya existe.
// body: { nombre, duracionCitaMinutos, anticipacionMinimaMin, horizonteAgendaDias }
// ------------------------------------------------------------
router.put('/recurso', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { nombre, duracionCitaMinutos, anticipacionMinimaMin, horizonteAgendaDias } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre del recurso (ej. nombre del negocio o profesional)' });
    }
    const duracion = Number(duracionCitaMinutos);
    if (!duracion || duracion <= 0) {
      return res.status(400).json({ error: 'duracionCitaMinutos debe ser un número mayor a 0' });
    }
    const anticipacion = anticipacionMinimaMin != null ? Number(anticipacionMinimaMin) : undefined;
    const horizonte = horizonteAgendaDias != null ? Number(horizonteAgendaDias) : undefined;
    if (anticipacion != null && anticipacion < 0) {
      return res.status(400).json({ error: 'anticipacionMinimaMin no puede ser negativo' });
    }
    if (horizonte != null && horizonte <= 0) {
      return res.status(400).json({ error: 'horizonteAgendaDias debe ser mayor a 0' });
    }

    const existente = await prisma.recursoAgendable.findFirst({ where: { empresaId } });

    const data = {
      nombre: nombre.trim(),
      duracionCitaMinutos: duracion,
      ...(anticipacion != null && { anticipacionMinimaMin: anticipacion }),
      ...(horizonte != null && { horizonteAgendaDias: horizonte }),
    };

    const recurso = existente
      ? await prisma.recursoAgendable.update({ where: { id: existente.id }, data })
      : await prisma.recursoAgendable.create({ data: { empresaId, tipo: 'profesional', ...data } });

    res.json({ recurso });
  } catch (error) {
    console.error('Error en PUT /agenda/recurso:', error);
    res.status(500).json({ error: 'Error al guardar el recurso agendable' });
  }
});

// ------------------------------------------------------------
// POST /agenda/profesionales — agrega un profesional adicional
// (segundo, tercer RecursoAgendable de tipo "profesional" en
// adelante). Válido según el límite del plan de la empresa:
//   PLAN_A / PLAN_INICIO_LEGACY / sin Suscripcion -> 1 profesional
//   PLAN_B                                        -> 2 profesionales
//   PLAN_C                                         -> ilimitado
// Si se supera el límite, responde 402 con mensaje de upsell (no
// bloquea la UI, el botón "Agregar profesional" siempre está visible
// para todos los planes).
// body: { nombre, duracionCitaMinutos, anticipacionMinimaMin, horizonteAgendaDias }
// ------------------------------------------------------------
const LIMITES_PROFESIONALES = {
  PLAN_A: 1,
  PLAN_B: 2,
  PLAN_C: Infinity,
  PLAN_INICIO_LEGACY: 1,
};

router.post('/profesionales', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { nombre, duracionCitaMinutos, anticipacionMinimaMin, horizonteAgendaDias } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre del profesional' });
    }
    const duracion = Number(duracionCitaMinutos);
    if (!duracion || duracion <= 0) {
      return res.status(400).json({ error: 'duracionCitaMinutos debe ser un número mayor a 0' });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { suscripcion: true },
    });

    const plan = empresa.suscripcion?.plan;
    const limite = plan && LIMITES_PROFESIONALES[plan] != null ? LIMITES_PROFESIONALES[plan] : LIMITES_PROFESIONALES.PLAN_A;

    const cantidadActual = await prisma.recursoAgendable.count({
      where: { empresaId, tipo: 'profesional' },
    });

    if (cantidadActual >= limite) {
      return res.status(402).json({
        error: 'LIMITE_PROFESIONALES_ALCANZADO',
        planActual: plan || 'SIN_SUSCRIPCION',
        cantidadActual,
        limite,
        mensaje: `Tu plan actual permite máximo ${limite} profesional(es). Mejora tu plan para agregar más.`,
      });
    }

    const anticipacion = anticipacionMinimaMin != null ? Number(anticipacionMinimaMin) : undefined;
    const horizonte = horizonteAgendaDias != null ? Number(horizonteAgendaDias) : undefined;

    const recurso = await prisma.recursoAgendable.create({
      data: {
        empresaId,
        tipo: 'profesional',
        nombre: nombre.trim(),
        duracionCitaMinutos: duracion,
        ...(anticipacion != null && { anticipacionMinimaMin: anticipacion }),
        ...(horizonte != null && { horizonteAgendaDias: horizonte }),
      },
    });

    res.status(201).json({ recurso });
  } catch (error) {
    console.error('Error en POST /agenda/profesionales:', error);
    res.status(500).json({ error: 'Error al crear el profesional' });
  }
});

// ------------------------------------------------------------
// GET /agenda/profesionales — lista todos los RecursoAgendable tipo
// "profesional" de la empresa, junto con el límite de su plan actual (para
// que el panel pueda mostrar "2 de 2 profesionales usados" y deshabilitar
// o redirigir a upsell el botón de agregar cuando corresponda).
// ------------------------------------------------------------
router.get('/profesionales', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { suscripcion: true },
    });

    const plan = empresa.suscripcion?.plan;
    const limite = plan && LIMITES_PROFESIONALES[plan] != null ? LIMITES_PROFESIONALES[plan] : LIMITES_PROFESIONALES.PLAN_A;

    const profesionales = await prisma.recursoAgendable.findMany({
      where: { empresaId, tipo: 'profesional' },
      include: {
        horarios: { orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] },
        usuarios: { select: { id: true, nombre: true, email: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    res.json({
      profesionales,
      plan: plan || 'SIN_SUSCRIPCION',
      limite: limite === Infinity ? null : limite,
      puedeAgregarMas: profesionales.length < limite,
    });
  } catch (error) {
    console.error('Error en GET /agenda/profesionales:', error);
    res.status(500).json({ error: 'Error al obtener los profesionales' });
  }
});

// ------------------------------------------------------------
// PUT /agenda/horarios — reemplaza el horario semanal completo del
// recurso de la empresa. Se manda la lista completa cada vez (no un
// parche parcial) para que la pantalla del panel sea la fuente de
// verdad de "así se ve el horario ahora", sin arrastrar bloques viejos
// que el usuario ya borró en la UI pero el backend nunca supo.
// body: { bloques: [{ diaSemana, horaInicio, horaFin }, ...] }
// ------------------------------------------------------------

router.put('/horarios', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { bloques, recursoId } = req.body;

    if (!Array.isArray(bloques)) {
      return res.status(400).json({ error: 'bloques debe ser un arreglo (puede ser vacío para dejar sin horario)' });
    }

    // Si viene recursoId (panel de gestión de profesionales, con más de
    // uno), se usa ese puntual. Si no viene, cae al primero — mismo
    // comportamiento de siempre para empresas con un solo profesional
    // (Ahorróptica y cualquier negocio en Plan A/Legacy).
    const recurso = recursoId
      ? await prisma.recursoAgendable.findFirst({ where: { id: recursoId, empresaId } })
      : await prisma.recursoAgendable.findFirst({ where: { empresaId } });

    if (!recurso) {
      return res.status(400).json({ error: 'Primero crea el recurso agendable (PUT /agenda/recurso) antes de cargar el horario' });
    }

    // Validar cada bloque individualmente
    for (const b of bloques) {
      if (typeof b.diaSemana !== 'number' || b.diaSemana < 0 || b.diaSemana > 6) {
        return res.status(400).json({ error: `diaSemana inválido: ${b.diaSemana}. Debe ser 0 (domingo) a 6 (sábado).` });
      }
      if (!REGEX_HORA.test(b.horaInicio) || !REGEX_HORA.test(b.horaFin)) {
        return res.status(400).json({ error: `Horas inválidas en el bloque del día ${b.diaSemana}: usa formato HH:MM.` });
      }
      if (horaAMinutos(b.horaInicio) >= horaAMinutos(b.horaFin)) {
        return res.status(400).json({ error: `El bloque del día ${b.diaSemana} tiene la hora de inicio igual o después de la de fin.` });
      }
    }

    // Validar que no se crucen dos bloques del mismo día
    const porDia = {};
    for (const b of bloques) {
      (porDia[b.diaSemana] ||= []).push(b);
    }
    for (const [dia, lista] of Object.entries(porDia)) {
      const ordenados = [...lista].sort((a, b) => horaAMinutos(a.horaInicio) - horaAMinutos(b.horaInicio));
      for (let i = 1; i < ordenados.length; i++) {
        if (horaAMinutos(ordenados[i].horaInicio) < horaAMinutos(ordenados[i - 1].horaFin)) {
          return res.status(400).json({ error: `Hay bloques de horario que se cruzan el día ${dia}.` });
        }
      }
    }

    const horariosActualizados = await prisma.$transaction(async (tx) => {
      await tx.horarioSemanal.deleteMany({ where: { recursoAgendableId: recurso.id } });
      if (bloques.length === 0) return [];
      await tx.horarioSemanal.createMany({
        data: bloques.map((b) => ({
          recursoAgendableId: recurso.id,
          diaSemana: b.diaSemana,
          horaInicio: b.horaInicio,
          horaFin: b.horaFin,
        })),
      });
      return tx.horarioSemanal.findMany({
        where: { recursoAgendableId: recurso.id },
        orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
      });
    });

    res.json({ horarios: horariosActualizados });
  } catch (error) {
    console.error('Error en PUT /agenda/horarios:', error);
    res.status(500).json({ error: 'Error al guardar el horario semanal' });
  }
});

// ------------------------------------------------------------
// POST /agenda/bloqueos — vacaciones, feriados puntuales, etc.
// body: { fechaInicio, fechaFin, motivo }  (fechas en formato YYYY-MM-DD)
// ------------------------------------------------------------
router.post('/bloqueos', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { fechaInicio, fechaFin, motivo } = req.body;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Faltan fechaInicio y/o fechaFin (formato YYYY-MM-DD)' });
    }

    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId } });
    if (!recurso) {
      return res.status(400).json({ error: 'Primero crea el recurso agendable antes de cargar bloqueos' });
    }

    // Se guardan como el día completo en UTC, mismo enfoque que
    // src/lib/horaChile.js usa para anclar fechas sin ambigüedad de zona
    // horaria (00:00 del día de inicio hasta 23:59 del día de fin).
    const inicio = new Date(`${fechaInicio}T00:00:00.000Z`);
    const fin = new Date(`${fechaFin}T23:59:59.999Z`);

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      return res.status(400).json({ error: 'Fechas inválidas, usa formato YYYY-MM-DD' });
    }
    if (inicio > fin) {
      return res.status(400).json({ error: 'fechaInicio no puede ser posterior a fechaFin' });
    }

    const bloqueo = await prisma.bloqueo.create({
      data: {
        recursoAgendableId: recurso.id,
        fechaInicio: inicio,
        fechaFin: fin,
        motivo: motivo || null,
      },
    });

    res.status(201).json({ bloqueo });
  } catch (error) {
    console.error('Error en POST /agenda/bloqueos:', error);
    res.status(500).json({ error: 'Error al crear el bloqueo' });
  }
});

// ------------------------------------------------------------
// DELETE /agenda/bloqueos/:id
// ------------------------------------------------------------
router.delete('/bloqueos/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId } });
    if (!recurso) {
      return res.status(404).json({ error: 'Esta empresa no tiene recurso agendable' });
    }

    const bloqueo = await prisma.bloqueo.findFirst({
      where: { id: req.params.id, recursoAgendableId: recurso.id },
    });
    if (!bloqueo) {
      return res.status(404).json({ error: 'Bloqueo no encontrado' });
    }

    await prisma.bloqueo.delete({ where: { id: bloqueo.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /agenda/bloqueos/:id:', error);
    res.status(500).json({ error: 'Error al eliminar el bloqueo' });
  }
});

// ============================================================
// PATCH /agenda/citas/:id/estado — cambiar estado de una cita
// body: { estado: 'CONFIRMADA' | 'COMPLETADA' | 'CANCELADA' | 'NO_ASISTIO' }
// ============================================================
router.patch('/citas/:id/estado', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const { estado } = req.body;
    const citaId = req.params.id;
    const empresaId = req.usuario.empresaId;

    // Validar que el estado sea válido
    const estadosValidos = ['CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO', 'PENDIENTE'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}` });
    }

    // Actualizar la cita
    const cita = await prisma.cita.update({
      where: { id: citaId },
      data: { estado },
      include: {
        cliente: {
          select: { id: true, nombre: true, telefono: true }
        },
        servicio: true,
        recurso: true,
      },
    });

    res.json({ cita });
  } catch (error) {
    console.error('Error en PATCH /agenda/citas/:id/estado:', error);
    res.status(500).json({ error: 'Error al actualizar estado de cita' });
  }
});

// POST /agenda/citas/:id/reagendar
// Reagenda una cita a una nueva fecha/hora
router.post('/citas/:id/reagendar', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nuevaFecha, nuevaHora, profesionalId } = req.body;

    if (!nuevaFecha || !nuevaHora) {
      return res.status(400).json({ error: 'Falta nuevaFecha o nuevaHora' });
    }

    // Obtener la cita
    const cita = await prisma.cita.findUnique({
      where: { id },
      include: { recurso: true, cliente: true },
    });

    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Validar que pertenezca a la empresa del usuario
    if (cita.empresa.id !== req.usuario.empresaId) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }

    // Parsear la nueva fecha/hora
    const [año, mes, día] = nuevaFecha.split('-').map(Number);
    const [hora, minutos] = nuevaHora.split(':').map(Number);

    const nuevaFechaHoraInicio = new Date(año, mes - 1, día, hora, minutos, 0);
    const nuevaFechaHoraFin = new Date(
      nuevaFechaHoraInicio.getTime() + (cita.recurso.duracionCitaMinutos || 30) * 60 * 1000
    );

    // Verificar que no haya conflicto con otras citas
    const conflicto = await prisma.cita.findFirst({
      where: {
        id: { not: id },
        recursoAgendableId: cita.recursoAgendableId,
        estado: { not: 'CANCELADA' },
        fechaHoraInicio: { lt: nuevaFechaHoraFin },
        fechaHoraFin: { gt: nuevaFechaHoraInicio },
      },
    });

    if (conflicto) {
      return res.status(400).json({ error: 'Hay un conflicto con otra cita en ese horario' });
    }

    // Actualizar la cita
    const citaActualizada = await prisma.cita.update({
      where: { id },
      data: {
        fechaHoraInicio: nuevaFechaHoraInicio,
        fechaHoraFin: nuevaFechaHoraFin,
        profesionalAsignadoId: profesionalId || null,
      },
      include: {
        cliente: true,
        recurso: true,
      },
    });

    res.json({
      message: 'Cita reagendada correctamente',
      cita: citaActualizada,
    });
  } catch (error) {
    console.error('Error en POST /agenda/citas/:id/reagendar:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;