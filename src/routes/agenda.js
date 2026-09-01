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
const { normalizarRut, esRutValido } = require('../lib/rut');
const { descifrar, esValorCifrado } = require('../lib/cifrado');

// Cliente.rut está cifrado en reposo (Ley 21.719, ver src/lib/prisma.js:
// CAMPOS_CIFRADOS) — la extensión de Prisma solo descifra automáticamente
// cuando se consulta el modelo Cliente DIRECTO (prisma.cliente.findMany/...),
// no cuando llega anidado dentro de un include de OTRO modelo (ej. cita.cliente).
// Sin este helper, esos casos devuelven el string "enc:v1:..." crudo tal
// cual — visto en producción en la columna Rut de Tabla de citas.
function descifrarSiCorresponde(valor) {
  if (valor && esValorCifrado(valor)) {
    try {
      return descifrar(valor);
    } catch (error) {
      console.error('[CIFRADO] Error descifrando rut anidado:', error.message);
      return valor;
    }
  }
  return valor;
}

const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function horaAMinutosLocal(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}
function minutosAHoraLocal(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0');
  const m = (minutos % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

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
    const { recursoId } = req.query; // opcional: filtra el dashboard a un solo profesional

    // Validar que el usuario pertenece a esta empresa
    if (req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Si viene recursoId, confirmamos que pertenece a esta empresa antes
    // de usarlo — evita que alguien filtre por el recurso de otra empresa.
    if (recursoId) {
      const recursoValido = await prisma.recursoAgendable.findFirst({
        where: { id: recursoId, empresaId },
      });
      if (!recursoValido) {
        return res.status(400).json({ error: 'recursoId no pertenece a esta empresa' });
      }
    }

    const filtroRecurso = recursoId ? { recursoAgendableId: recursoId } : {};

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
        ...filtroRecurso,
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
        ...filtroRecurso,
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
        ...filtroRecurso,
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
        ...filtroRecurso,
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
    ...filtroRecurso,
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
        rut: true,
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
        rut: descifrarSiCorresponde(cita.cliente?.rut) || null,
        notas: null,
      };
    });

    // ------------------------------------------------------------
    // KPIs de negocio para el Dashboard (gráficos) — ver Venta en
    // schema.prisma, ya usado por POST /clientes/:id/ventas. Las ventas no
    // están asociadas a un profesional, así que filtroRecurso no aplica acá.
    // ------------------------------------------------------------
    function fechaChileISO(fecha) {
      const p = formatter.formatToParts(fecha);
      return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
    }
    function mesChileISO(fecha) {
      const p = formatter.formatToParts(fecha);
      return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
    }

    // 6. MONTO DEL DÍA / SEMANA (lunes a hoy, hora Chile)
    const diasDesdeLunes = (hoyChile.getUTCDay() + 6) % 7;
    const inicioSemanaChile = new Date(hoyChile.getTime() - diasDesdeLunes * 24 * 60 * 60 * 1000);

    const [ventasHoyAgg, ventasSemanaAgg, atencionesHoy] = await Promise.all([
      prisma.venta.aggregate({ where: { empresaId, fecha: { gte: hoyChile, lt: mañanaChile } }, _sum: { monto: true } }),
      prisma.venta.aggregate({ where: { empresaId, fecha: { gte: inicioSemanaChile, lt: mañanaChile } }, _sum: { monto: true } }),
      prisma.venta.count({ where: { empresaId, fecha: { gte: hoyChile, lt: mañanaChile } } }),
    ]);
    const montoHoy = ventasHoyAgg._sum.monto || 0;
    const montoSemana = ventasSemanaAgg._sum.monto || 0;

    // 7. CITAS POR DÍA — últimos 14 días (incluye hoy)
    const hace14Dias = new Date(hoyChile.getTime() - 13 * 24 * 60 * 60 * 1000);
    const citasUltimos14Dias = await prisma.cita.findMany({
      where: { empresaId, ...filtroRecurso, fechaHoraInicio: { gte: hace14Dias, lt: mañanaChile } },
      select: { fechaHoraInicio: true },
    });
    const citasPorDiaMap = new Map();
    for (let i = 0; i < 14; i++) {
      citasPorDiaMap.set(fechaChileISO(new Date(hace14Dias.getTime() + i * 24 * 60 * 60 * 1000)), 0);
    }
    citasUltimos14Dias.forEach((c) => {
      const key = fechaChileISO(c.fechaHoraInicio);
      if (citasPorDiaMap.has(key)) citasPorDiaMap.set(key, citasPorDiaMap.get(key) + 1);
    });
    const citasPorDia = Array.from(citasPorDiaMap, ([fecha, cantidad]) => ({ fecha, cantidad }));

    // 7.5 CITAS PRÓXIMOS 6 DÍAS (incluye hoy) — a diferencia de citasPorDia
    // (volumen histórico), acá interesa la carga real que queda por venir,
    // así que se excluyen las CANCELADA (un cupo cancelado ya no está tomado).
    const finProximosDias = new Date(hoyChile.getTime() + 6 * 24 * 60 * 60 * 1000);
    const citasProximos6DiasRaw = await prisma.cita.findMany({
      where: {
        empresaId,
        ...filtroRecurso,
        estado: { not: 'CANCELADA' },
        fechaHoraInicio: { gte: hoyChile, lt: finProximosDias },
      },
      select: { fechaHoraInicio: true },
    });
    const citasProximosDiasMap = new Map();
    for (let i = 0; i < 6; i++) {
      citasProximosDiasMap.set(fechaChileISO(new Date(hoyChile.getTime() + i * 24 * 60 * 60 * 1000)), 0);
    }
    citasProximos6DiasRaw.forEach((c) => {
      const key = fechaChileISO(c.fechaHoraInicio);
      if (citasProximosDiasMap.has(key)) citasProximosDiasMap.set(key, citasProximosDiasMap.get(key) + 1);
    });
    const citasProximosDias = Array.from(citasProximosDiasMap, ([fecha, cantidad]) => ({ fecha, cantidad }));

    // 8. ATENCIONES POR TIPO DE SERVICIO — Venta.categoriaProducto, último año
    const hace1Anio = new Date(hoyChile.getTime() - 365 * 24 * 60 * 60 * 1000);
    const ventasParaTipo = await prisma.venta.findMany({
      where: { empresaId, fecha: { gte: hace1Anio, lt: mañanaChile } },
      select: { categoriaProducto: true },
    });
    const tipoMap = new Map();
    ventasParaTipo.forEach((v) => {
      const categoria = v.categoriaProducto || 'Sin categoría';
      tipoMap.set(categoria, (tipoMap.get(categoria) || 0) + 1);
    });
    const atencionesPorTipo = Array.from(tipoMap, ([categoria, cantidad]) => ({ categoria, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // 9 y 10. EVOLUCIÓN MENSUAL DE CITAS Y DINERO — últimos 6 meses
    const inicioRangoMensual = new Date(hoyChile);
    inicioRangoMensual.setMonth(inicioRangoMensual.getMonth() - 5);
    inicioRangoMensual.setDate(1);
    inicioRangoMensual.setHours(0, 0, 0, 0);

    const [citasParaMensual, ventasParaMensual] = await Promise.all([
      prisma.cita.findMany({
        where: { empresaId, ...filtroRecurso, fechaHoraInicio: { gte: inicioRangoMensual, lt: mañanaChile } },
        select: { fechaHoraInicio: true },
      }),
      prisma.venta.findMany({
        where: { empresaId, fecha: { gte: inicioRangoMensual, lt: mañanaChile } },
        select: { fecha: true, monto: true },
      }),
    ]);

    const mesesOrdenados = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoyChile);
      d.setMonth(d.getMonth() - i);
      mesesOrdenados.push(mesChileISO(d));
    }

    const citasPorMesMap = new Map(mesesOrdenados.map((m) => [m, 0]));
    citasParaMensual.forEach((c) => {
      const key = mesChileISO(c.fechaHoraInicio);
      if (citasPorMesMap.has(key)) citasPorMesMap.set(key, citasPorMesMap.get(key) + 1);
    });
    const citasPorMes = mesesOrdenados.map((mes) => ({ mes, cantidad: citasPorMesMap.get(mes) }));

    const dineroPorMesMap = new Map(mesesOrdenados.map((m) => [m, 0]));
    ventasParaMensual.forEach((v) => {
      const key = mesChileISO(v.fecha);
      if (dineroPorMesMap.has(key)) dineroPorMesMap.set(key, dineroPorMesMap.get(key) + v.monto);
    });
    const dineroPorMes = mesesOrdenados.map((mes) => ({ mes, monto: dineroPorMesMap.get(mes) }));

    res.json({
      citasHoy,
      confirmadas,
      listaEspera,
      asistencia30dias,
      agendaHoy: agendaFormato,
      montoHoy,
      montoSemana,
      atencionesHoy,
      citasProximosDias,
      citasPorDia,
      atencionesPorTipo,
      citasPorMes,
      dineroPorMes,
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
router.get('/profesionales', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
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
        bloqueos: { orderBy: { fechaInicio: 'asc' } },
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
// PATCH /agenda/profesionales/:id — edita los datos base de un
// profesional ya creado (nombre, duración de cita, anticipación,
// horizonte). Sin esto, un negocio Plan B/C que no ve "Configuración de
// agenda" no tendría forma de tocar estos campos después de la creación.
// body: { nombre?, duracionCitaMinutos?, anticipacionMinimaMin?, horizonteAgendaDias? }
// ------------------------------------------------------------
router.patch('/profesionales/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const recurso = await prisma.recursoAgendable.findFirst({
      where: { id: req.params.id, empresaId, tipo: 'profesional' },
    });
    if (!recurso) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    const { nombre, duracionCitaMinutos, anticipacionMinimaMin, horizonteAgendaDias } = req.body;

    if (nombre !== undefined && !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    }
    if (duracionCitaMinutos !== undefined && Number(duracionCitaMinutos) <= 0) {
      return res.status(400).json({ error: 'duracionCitaMinutos debe ser un número mayor a 0' });
    }
    if (anticipacionMinimaMin !== undefined && Number(anticipacionMinimaMin) < 0) {
      return res.status(400).json({ error: 'anticipacionMinimaMin no puede ser negativo' });
    }
    if (horizonteAgendaDias !== undefined && Number(horizonteAgendaDias) <= 0) {
      return res.status(400).json({ error: 'horizonteAgendaDias debe ser mayor a 0' });
    }

    const actualizado = await prisma.recursoAgendable.update({
      where: { id: recurso.id },
      data: {
        ...(nombre !== undefined && { nombre: nombre.trim() }),
        ...(duracionCitaMinutos !== undefined && { duracionCitaMinutos: Number(duracionCitaMinutos) }),
        ...(anticipacionMinimaMin !== undefined && { anticipacionMinimaMin: Number(anticipacionMinimaMin) }),
        ...(horizonteAgendaDias !== undefined && { horizonteAgendaDias: Number(horizonteAgendaDias) }),
      },
    });

    res.json({ recurso: actualizado });
  } catch (error) {
    console.error('Error en PATCH /agenda/profesionales/:id:', error);
    res.status(500).json({ error: 'Error al actualizar el profesional' });
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
    const { fechaInicio, fechaFin, motivo, recursoId } = req.body;
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Faltan fechaInicio y/o fechaFin (formato YYYY-MM-DD)' });
    }
    // Mismo patrón que PUT /agenda/horarios: si viene recursoId (panel de
    // gestión de profesionales) se usa ese puntual; si no, cae al primero
    // (comportamiento de siempre para un solo profesional).
    const recurso = recursoId
      ? await prisma.recursoAgendable.findFirst({ where: { id: recursoId, empresaId } })
      : await prisma.recursoAgendable.findFirst({ where: { empresaId } });
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
    // Se busca el bloqueo entre TODOS los recursos de la empresa, no solo
    // el primero — antes, un bloqueo de un segundo profesional nunca se
    // encontraba y devolvía 404 falso.
    const bloqueo = await prisma.bloqueo.findFirst({
      where: { id: req.params.id, recurso: { empresaId } },
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

    // Validar que la cita pertenezca a la empresa del usuario ANTES de
    // actualizar — sin esto, cualquier ADMIN/RECEPCION autenticado podía
    // cambiar el estado de una cita de OTRA empresa con solo conocer su id
    // (no había ningún filtro de empresaId en el update). Bug real
    // encontrado el 2026-08-31 al construir la tabla de doble entrada.
    const citaExistente = await prisma.cita.findFirst({ where: { id: citaId, empresaId } });
    if (!citaExistente) {
      return res.status(404).json({ error: 'Cita no encontrada' });
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

    // Validar que pertenezca a la empresa del usuario. Antes comparaba
    // cita.empresa.id, pero la consulta de arriba nunca incluye la relación
    // "empresa" (solo recurso/cliente) — cita.empresa siempre era undefined
    // y esto tiraba un TypeError antes de llegar a validar nada, dejando
    // este endpoint roto para toda cita. Se usa el campo escalar empresaId
    // directo, que sí viene siempre.
    if (cita.empresaId !== req.usuario.empresaId) {
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

    // Actualizar la cita. "profesionalId" en este contexto es un
    // recursoAgendableId (ver modelo multi-profesional: un profesional ES
    // un RecursoAgendable) — el campo "profesionalAsignadoId" que se
    // intentaba escribir acá antes no existe en el modelo Cita, así que
    // esta actualización siempre fallaba con un error de Prisma.
    const citaActualizada = await prisma.cita.update({
      where: { id },
      data: {
        fechaHoraInicio: nuevaFechaHoraInicio,
        fechaHoraFin: nuevaFechaHoraFin,
        ...(profesionalId && { recursoAgendableId: profesionalId }),
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

// ============================================================
// GET /agenda/citas?fecha=YYYY-MM-DD — citas de un día puntual (no solo
// "hoy" como /dashboard/:empresaId), para la tabla de doble entrada del
// panel que reemplaza el seguimiento manual en Excel.
// ============================================================
router.get('/citas', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const { fecha, recursoId } = req.query;
    const empresaId = req.usuario.empresaId;

    if (!fecha || !REGEX_FECHA.test(fecha)) {
      return res.status(400).json({ error: 'Falta o es inválido el parámetro "fecha" (formato YYYY-MM-DD)' });
    }

    if (recursoId) {
      const recursoValido = await prisma.recursoAgendable.findFirst({ where: { id: recursoId, empresaId } });
      if (!recursoValido) {
        return res.status(400).json({ error: 'recursoId no pertenece a esta empresa' });
      }
    }

    const inicioDia = horaChileAFechaUTC(fecha, '00:00');
    const finDia = horaChileAFechaUTC(fecha, '23:59');

    const citas = await prisma.cita.findMany({
      where: {
        empresaId,
        ...(recursoId ? { recursoAgendableId: recursoId } : {}),
        fechaHoraInicio: { gte: inicioDia, lte: finDia },
      },
      include: {
        cliente: { select: { id: true, nombre: true, rut: true, telefono: true } },
        servicio: true,
        recurso: true,
      },
      orderBy: { fechaHoraInicio: 'asc' },
    });

    const formatterHora = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const resultado = citas.map((c) => ({
      id: c.id,
      hora: formatterHora.format(c.fechaHoraInicio),
      clienteId: c.clienteId,
      nombre: c.cliente?.nombre || 'Sin asignar',
      rut: descifrarSiCorresponde(c.cliente?.rut) || null,
      telefono: c.cliente?.telefono || null,
      servicioId: c.servicioId,
      servicio: c.servicio?.nombre || 'Sin especificar',
      recursoAgendableId: c.recursoAgendableId,
      profesional: c.recurso?.nombre || 'Sin asignar',
      estado: c.estado,
      vacio: false,
    }));

    // Si se pidió un profesional puntual, se agregan filas "vacías" por cada
    // horario libre ese día (según su horario semanal y bloqueos) — para
    // que la tabla muestre el día completo, no solo los horarios con
    // paciente (pedido explícito del usuario: comparar contra otro
    // calendario para adivinar los huecos era justo lo que quería evitar).
    // Solo tiene sentido con UN recurso puntual — con "todos los
    // profesionales" cada uno tiene su propio horario en paralelo, mezclar
    // huecos de varios sería engañoso.
    if (recursoId) {
      const recurso = await prisma.recursoAgendable.findUnique({ where: { id: recursoId } });
      const [anio, mes, dia] = fecha.split('-').map(Number);
      const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();

      const horarios = await prisma.horarioSemanal.findMany({
        where: { recursoAgendableId: recursoId, diaSemana, activo: true },
      });
      const bloqueos = await prisma.bloqueo.findMany({
        where: { recursoAgendableId: recursoId, fechaInicio: { lte: finDia }, fechaFin: { gte: inicioDia } },
      });

      const duracion = recurso.duracionCitaMinutos;
      const horasConCita = new Set(resultado.map((r) => r.hora));

      for (const bloque of horarios) {
        let cursor = horaAMinutosLocal(bloque.horaInicio);
        const finBloque = horaAMinutosLocal(bloque.horaFin);

        while (cursor + duracion <= finBloque) {
          const horaSlot = minutosAHoraLocal(cursor);
          if (!horasConCita.has(horaSlot)) {
            const inicioSlot = horaChileAFechaUTC(fecha, horaSlot);
            const finSlot = new Date(inicioSlot.getTime() + duracion * 60000);
            const chocaConBloqueo = bloqueos.some((b) => inicioSlot < b.fechaFin && finSlot > b.fechaInicio);
            if (!chocaConBloqueo) {
              resultado.push({
                id: `vacio-${horaSlot}`,
                hora: horaSlot,
                clienteId: null,
                nombre: null,
                rut: null,
                telefono: null,
                servicioId: null,
                servicio: null,
                recursoAgendableId: recurso.id,
                profesional: recurso.nombre,
                estado: null,
                vacio: true,
              });
            }
          }
          cursor += duracion;
        }
      }

      resultado.sort((a, b) => a.hora.localeCompare(b.hora));
    }

    res.json({ citas: resultado });
  } catch (error) {
    console.error('Error en GET /agenda/citas:', error);
    res.status(500).json({ error: 'Error al obtener las citas del día' });
  }
});

// ============================================================
// POST /agenda/citas — crea una cita manual (walk-in) desde el panel.
// Si no viene clienteId, busca un Cliente existente de esta empresa por
// rut (si viene) y si no por teléfono, antes de crear uno nuevo — para no
// duplicar pacientes que ya se agendaron antes por WhatsApp.
// ============================================================
router.post('/citas', requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { fecha, hora, servicioId, recursoAgendableId, clienteId, clienteNuevo } = req.body;

    if (!fecha || !REGEX_FECHA.test(fecha)) {
      return res.status(400).json({ error: 'Falta o es inválido "fecha" (formato YYYY-MM-DD)' });
    }
    if (!hora || !REGEX_HORA.test(hora)) {
      return res.status(400).json({ error: 'Falta o es inválido "hora" (formato HH:MM)' });
    }
    if (!clienteId && (!clienteNuevo || !clienteNuevo.nombre || !clienteNuevo.nombre.trim())) {
      return res.status(400).json({ error: 'Falta "clienteId" o "clienteNuevo.nombre"' });
    }

    let servicio = null;
    if (servicioId) {
      servicio = await prisma.servicio.findFirst({ where: { id: servicioId, empresaId } });
      if (!servicio) return res.status(400).json({ error: 'servicioId no pertenece a esta empresa' });
    }

    const fechaHoraInicio = horaChileAFechaUTC(fecha, hora);

    async function tieneConflicto(recursoId, fin) {
      const c = await prisma.cita.findFirst({
        where: {
          recursoAgendableId: recursoId,
          estado: { not: 'CANCELADA' },
          fechaHoraInicio: { lt: fin },
          fechaHoraFin: { gt: fechaHoraInicio },
        },
      });
      return Boolean(c);
    }

    // Resolver el recurso: el que se pida, el único que tenga la empresa, o
    // — cuando el panel manda "no especificar" con 2+ profesionales — el
    // menos ocupado ese día que además esté libre justo a esa hora (ver
    // conversación 2026-08-31: exigir elegir uno a mano bloqueaba el
    // guardado cuando al admin no le importa quién, o no sabe de antemano
    // quién está libre).
    let recurso;
    let fechaHoraFin;
    if (recursoAgendableId) {
      recurso = await prisma.recursoAgendable.findFirst({ where: { id: recursoAgendableId, empresaId } });
      if (!recurso) return res.status(400).json({ error: 'recursoAgendableId no pertenece a esta empresa' });
      // La duración de la cita sale SIEMPRE del profesional/calendario
      // (RecursoAgendable.duracionCitaMinutos, configurable en "Datos de la
      // agenda"), nunca del Servicio — así lo pidió el usuario 2026-08-31:
      // un Servicio es solo una etiqueta que el bot lista, no debe competir
      // con la duración real del calendario. Coherente con cómo ya
      // funcionaba `crearCita` en disponibilidad.js (el motor real del bot
      // nunca miró servicio.duracionMinutos, esto solo alineaba el código
      // nuevo de "Agregar cita" manual con eso).
      fechaHoraFin = new Date(fechaHoraInicio.getTime() + (recurso.duracionCitaMinutos || 30) * 60 * 1000);
      if (await tieneConflicto(recurso.id, fechaHoraFin)) {
        return res.status(400).json({ error: 'Hay un conflicto con otra cita en ese horario' });
      }
    } else {
      // Filtra por tipo:'profesional' para calzar exactamente con la lista
      // que ve el panel en GET /agenda/profesionales.
      const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId, tipo: 'profesional' } });
      if (recursos.length === 0) {
        return res.status(400).json({ error: 'La empresa no tiene ningún profesional configurado' });
      }

      const inicioDia = horaChileAFechaUTC(fecha, '00:00');
      const finDia = horaChileAFechaUTC(fecha, '23:59');
      const conteos = await Promise.all(
        recursos.map((r) =>
          prisma.cita.count({
            where: { recursoAgendableId: r.id, estado: { not: 'CANCELADA' }, fechaHoraInicio: { gte: inicioDia, lte: finDia } },
          })
        )
      );
      const candidatos = recursos
        .map((r, idx) => ({ r, conteo: conteos[idx] }))
        .sort((a, b) => a.conteo - b.conteo)
        .map((x) => x.r);

      for (const candidato of candidatos) {
        const finTentativo = new Date(fechaHoraInicio.getTime() + (candidato.duracionCitaMinutos || 30) * 60 * 1000);
        if (!(await tieneConflicto(candidato.id, finTentativo))) {
          recurso = candidato;
          fechaHoraFin = finTentativo;
          break;
        }
      }

      if (!recurso) {
        return res.status(400).json({ error: 'Todos los profesionales tienen un conflicto de horario a esa hora' });
      }
    }

    // Resolver el cliente: existente por id, existente por rut/teléfono, o nuevo.
    let cliente;
    if (clienteId) {
      cliente = await prisma.cliente.findFirst({ where: { id: clienteId, empresaId } });
      if (!cliente) return res.status(400).json({ error: 'clienteId no pertenece a esta empresa' });
    } else {
      // Normaliza igual que el flujo del bot (claude.js) — si no, "12.345.678-9"
      // tecleado acá y "12345678-9" guardado por el bot para la misma
      // persona no calzarían nunca en el dedupe de más abajo. Si no tiene
      // forma de rut válido se guarda tal cual (recortado) en vez de
      // rechazar — acá es un humano escribiendo, no la IA extrayendo de
      // texto libre, así que no se fuerza el formato.
      const rutTrim = clienteNuevo.rut?.trim() || null;
      const rut = rutTrim ? (esRutValido(normalizarRut(rutTrim)) ? normalizarRut(rutTrim) : rutTrim) : null;
      const telefono = clienteNuevo.telefono?.trim() || null;

      // Cliente.rut está cifrado en reposo con AES-256-GCM e IV aleatorio
      // (Ley 21.719, ver src/lib/prisma.js) — el mismo rut en texto plano
      // produce un ciphertext DISTINTO cada vez que se cifra, así que un
      // "where: { rut }" nunca puede calzar contra lo guardado (comparaba
      // texto plano contra ciphertext, literalmente imposible que matcheen).
      // El dedupe por rut se quedó silenciosamente roto en cuanto se activó
      // el cifrado — nunca reusaba al paciente, creaba uno nuevo cada vez.
      // Única forma correcta: traer los candidatos (ya descifrados por la
      // extensión de Prisma, por ser consulta directa al modelo Cliente) y
      // comparar en JS.
      if (rut) {
        const candidatosPorRut = await prisma.cliente.findMany({ where: { empresaId, rut: { not: null } } });
        cliente = candidatosPorRut.find((c) => c.rut === rut) || null;
      }
      if (!cliente && telefono) cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono } });

      if (!cliente) {
        cliente = await prisma.cliente.create({
          data: { empresaId, nombre: clienteNuevo.nombre.trim(), rut, telefono },
        });
      }
    }

    const cita = await prisma.cita.create({
      data: {
        empresaId,
        clienteId: cliente.id,
        recursoAgendableId: recurso.id,
        servicioId: servicio?.id || null,
        fechaHoraInicio,
        fechaHoraFin,
        estado: 'CONFIRMADA',
        origenCanal: 'panel',
      },
      include: { cliente: true, servicio: true, recurso: true },
    });

    // Mismo caso de cliente anidado sin descifrar automáticamente (ver
    // descifrarSiCorresponde arriba) — acá no se usa hoy desde el panel,
    // pero se corrige igual para no dejar ciphertext crudo en ninguna
    // respuesta de la API.
    if (cita.cliente) {
      cita.cliente.rut = descifrarSiCorresponde(cita.cliente.rut);
    }

    res.status(201).json({ cita });
  } catch (error) {
    console.error('Error en POST /agenda/citas:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
});

module.exports = router;