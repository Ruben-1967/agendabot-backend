// src/lib/horaChile.js
//
// Convierte una fecha+hora "de pared" en Chile (sin zona horaria explícita,
// ej. fechaISO='2026-07-20', horaHHMM='10:00') al instante UTC real que le
// corresponde.
//
// POR QUÉ EXISTE: `new Date('2026-07-20T10:00:00')` en Node NO interpreta
// esa hora como Chile — la interpreta como hora LOCAL DEL SERVIDOR, que en
// Render es UTC. Eso significa que una cita pedida para las 10:00 (hora de
// Chile) terminaba guardándose como si fueran las 10:00 UTC — es decir, las
// 06:00 de Chile. El bug es silencioso porque la lista de horarios que ve el
// cliente (ej. "10:00, 10:30...") se arma con puro texto, sin pasar por este
// cálculo — el desfase solo afecta el timestamp real guardado en la base
// (Cita.fechaHoraInicio) y cualquier comparación contra la hora actual (ej.
// anticipación mínima para agendar, o el recordatorio de 24h).
//
// Usa Intl (vía toLocaleString) para calcular el offset vigente en el
// momento exacto, en vez de asumir un valor fijo — así sigue funcionando
// aunque Chile cambie de horario de verano en el futuro.
function horaChileAFechaUTC(fechaISO, horaHHMM) {
  // Paso 1: tratamos la fecha+hora como si fuera UTC (a propósito, es solo
  // un ancla intermedia para el cálculo, no el resultado final).
  const ingenua = new Date(`${fechaISO}T${horaHHMM}:00Z`);

  // Paso 2: ¿qué hora muestra esa misma marca de tiempo si la miramos desde
  // Chile? La diferencia entre lo que pusimos y lo que Chile ve a esa marca
  // es el offset real vigente ese día (considera automáticamente si hay
  // horario de verano o no).
  const comoTextoEnChile = ingenua.toLocaleString('en-US', { timeZone: 'America/Santiago' });
  const reinterpretadaEnChile = new Date(comoTextoEnChile);
  const offsetMs = ingenua.getTime() - reinterpretadaEnChile.getTime();

  // Paso 3: aplicamos ese offset para obtener el instante UTC real que
  // corresponde a la hora de pared en Chile que se pidió originalmente.
  return new Date(ingenua.getTime() + offsetMs);
}

module.exports = { horaChileAFechaUTC };