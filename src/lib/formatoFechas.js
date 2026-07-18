/**
 * Convierte una fecha ISO ('YYYY-MM-DD') a texto legible en español,
 * ej. "lunes 20 de julio". Construida y formateada en UTC sin conversión,
 * para no arrastrar el bug de día corrido que ya se corrigió antes en
 * horaChile.js.
 */
function fechaLegibleDesdeISO(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fechaComoUTC = new Date(Date.UTC(anio, mes - 1, dia));
  return fechaComoUTC.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

module.exports = { fechaLegibleDesdeISO };