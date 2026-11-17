// Agenda REAL para demos personalizadas (17-nov-2026, demo de la Clínica del
// Dolor de Espalda). Si la empresa de demo tiene agendas (RecursoAgendable) con
// horario y el servicio elegido está ligado a una de ellas, la demo por WhatsApp
// ofrece las horas libres REALES de esa agenda y, al confirmar, GRABA la cita en
// la empresa de demo: el prospecto la ve aparecer en la Tabla de citas del panel.
//
// Si no hay agenda real (la gran mayoría de las demos), todo sigue igual que
// antes: días y horas simulados (src/lib/agendaDemoSimulada.js) y nada se graba.
//
// Seguridad: solo escribe en empresas esDemo=true y SIN WhatsApp propio
// (whatsappNumeroId null). Con eso ningún job manda recordatorios ni
// confirmaciones por estas citas (todos exigen whatsappNumeroId), aunque el
// Cliente quede con el teléfono real de quien prueba la demo.

const prisma = require('./prisma');
const { obtenerProximosDiasParaServicio, obtenerHorasDisponiblesParaServicio, crearCita } = require('../services/disponibilidad');
const { generarProximosDiasSimulados, generarHorasSimuladasParaDia } = require('./agendaDemoSimulada');

const DIAS_A_MOSTRAR = 4;
const MAX_HORAS_LISTA = 10; // límite de filas de una lista de WhatsApp

async function agendaRealDelServicio(empresaId, nombreServicio) {
  if (!empresaId || !nombreServicio) return null;
  const servicio = await prisma.servicio.findFirst({
    where: { empresaId, nombre: nombreServicio, activo: true },
    select: { id: true, recursos: { select: { recurso: { select: { id: true, nombre: true, horarios: { select: { id: true }, take: 1 } } } } } },
  });
  const recurso = servicio?.recursos.map((r) => r.recurso).find((r) => r.horarios.length > 0);
  if (!recurso) return null;
  return { servicioId: servicio.id, recursoId: recurso.id, recursoNombre: recurso.nombre };
}

/** Días para la lista de la demo: reales si hay agenda, si no simulados. */
async function diasParaDemo(empresaDemo, nombreServicio) {
  try {
    const agenda = await agendaRealDelServicio(empresaDemo?.id, nombreServicio);
    if (agenda) {
      const dias = await obtenerProximosDiasParaServicio(agenda.servicioId, DIAS_A_MOSTRAR, 21, agenda.recursoId);
      if (dias.length > 0) return dias.map((d) => ({ fecha: d.fecha, primeraHora: d.horas[0] }));
    }
  } catch (err) {
    console.error('[DEMO-AGENDA-REAL] Error calculando días reales, se usan simulados:', err.message);
  }
  return generarProximosDiasSimulados();
}

/** Horas de un día para la demo: reales si hay agenda, si no simuladas. */
async function horasParaDemo(demoAsignada, fechaISO) {
  try {
    const agenda = await agendaRealDelServicio(demoAsignada?.empresaDemoId, demoAsignada?.citaDemoJson?.servicio);
    if (agenda) {
      const horas = await obtenerHorasDisponiblesParaServicio(agenda.servicioId, fechaISO, agenda.recursoId);
      return horas.slice(0, MAX_HORAS_LISTA);
    }
  } catch (err) {
    console.error('[DEMO-AGENDA-REAL] Error calculando horas reales, se usan simuladas:', err.message);
  }
  return generarHorasSimuladasParaDia(fechaISO);
}

/**
 * Graba la cita de la demo en la agenda real de la empresa de demo.
 * @returns {Promise<{ok: true, recursoNombre: string} | {ok: false, motivo: string} | null>}
 *   null = esta demo no tiene agenda real (no se intenta grabar nada).
 */
async function grabarCitaDemo({ empresaId, nombreServicio, fechaISO, hora, nombre, telefono }) {
  if (!fechaISO || !hora) return null;
  // Todo dentro del try: un error de base de datos nunca debe dejar al prospecto sin respuesta.
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { esDemo: true, whatsappNumeroId: true } });
    if (!empresa?.esDemo || empresa.whatsappNumeroId) return null; // nunca en empresas reales ni con WhatsApp propio
    const agenda = await agendaRealDelServicio(empresaId, nombreServicio);
    if (!agenda) return null;

    let cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono }, select: { id: true } });
    if (!cliente) {
      cliente = await prisma.cliente.create({ data: { empresaId, nombre, telefono }, select: { id: true } });
    }
    const cita = await crearCita({
      empresaId,
      clienteId: cliente.id,
      recursoAgendableId: agenda.recursoId,
      servicioId: agenda.servicioId,
      fechaISO,
      horaInicio: hora,
      nombrePaciente: nombre,
    });
    await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'CONFIRMADA' }, select: { id: true } });
    return { ok: true, recursoNombre: agenda.recursoNombre };
  } catch (err) {
    if (err.message === 'HORARIO_YA_NO_DISPONIBLE') return { ok: false, motivo: 'HORARIO_YA_NO_DISPONIBLE' };
    console.error('[DEMO-AGENDA-REAL] Error grabando la cita de la demo:', err.message);
    return { ok: false, motivo: 'ERROR' };
  }
}

module.exports = { diasParaDemo, horasParaDemo, grabarCitaDemo };
