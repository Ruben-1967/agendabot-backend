// Generador de días/horas SIMULADOS para la demo comercial de agendamiento.
// A propósito no toca RecursoAgendable/HorarioSemanal/Cita reales — las
// empresas de demo (esDemo: true) no tienen agenda real cargada, y no
// queremos que la demo dependa de eso ni escriba citas reales en la base.

const DIAS_A_MOSTRAR = 4;

const BLOQUES_SEMANA = {
  // Lunes a viernes; domingo cerrado (mismo patrón que el horario real de Ahorróptica).
  habil: [
    ['09:30', '13:30'],
    ['15:00', '19:00'],
  ],
  sabado: [
    ['10:00', '14:00'],
  ],
};

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function esDomingo(date) {
  return date.getUTCDay() === 0;
}

function generarHorasSimuladasParaDia(fechaISOStr) {
  const date = new Date(`${fechaISOStr}T00:00:00Z`);
  const diaSemana = date.getUTCDay(); // 0 domingo ... 6 sábado
  const bloques = diaSemana === 6 ? BLOQUES_SEMANA.sabado : BLOQUES_SEMANA.habil;

  const horas = [];
  for (const [inicio, fin] of bloques) {
    let [h, m] = inicio.split(':').map(Number);
    const [hFin, mFin] = fin.split(':').map(Number);
    while (h < hFin || (h === hFin && m < mFin)) {
      horas.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      m += 45;
      if (m >= 60) { m -= 60; h += 1; }
    }
  }

  // Para que se sienta real, "reservamos" un par de horarios de forma
  // determinística según la fecha — si el prospecto vuelve a pedir el mismo
  // día, ve siempre los mismos horarios (no cambia entre mensajes).
  const semilla = fechaISOStr.split('-').reduce((acc, n) => acc + Number(n), 0);
  return horas.filter((_, i) => (i + semilla) % 4 !== 0).slice(0, 6);
}

function generarProximosDiasSimulados() {
  const dias = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() + 1); // desde mañana

  while (dias.length < DIAS_A_MOSTRAR) {
    if (!esDomingo(cursor)) {
      const fecha = fechaISO(cursor);
      const horas = generarHorasSimuladasParaDia(fecha);
      if (horas.length > 0) {
        dias.push({ fecha, primeraHora: horas[0] });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
}

module.exports = { generarProximosDiasSimulados, generarHorasSimuladasParaDia };