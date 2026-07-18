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
// PUT    /agenda/recurso           -> crea o actualiza el RecursoAgendable base
// PUT    /agenda/horarios          -> reemplaza el horario semanal completo
// POST   /agenda/bloqueos          -> crea un bloqueo (vacaciones, feriado, etc.)
// DELETE /agenda/bloqueos/:id      -> elimina un bloqueo

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function horaAMinutos(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
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
    const { bloques } = req.body;

    if (!Array.isArray(bloques)) {
      return res.status(400).json({ error: 'bloques debe ser un arreglo (puede ser vacío para dejar sin horario)' });
    }

    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId } });
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

module.exports = router;