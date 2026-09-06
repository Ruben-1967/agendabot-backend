// Lógica de elegibilidad del recordatorio de control anual (rubro óptica) —
// compartida entre jobs/enviarRecordatorios.js (el envío real) y las rutas
// del panel de autoservicio (routes/recordatorioControlAnual.js, el conteo
// de "pendientes"), para que ambos siempre coincidan.

const MESES_MINIMOS_SIN_CONTROL = 11;
const DIAS_MINIMOS_ENTRE_RECORDATORIOS = 300; // ~10 meses, evita reenviar en el mismo ciclo

function mesesDesde(fechaISO) {
  const fecha = new Date(fechaISO);
  const ahora = new Date();
  return (ahora - fecha) / (1000 * 60 * 60 * 24 * 30);
}

function diasDesde(fecha) {
  return (new Date() - new Date(fecha)) / (1000 * 60 * 60 * 24);
}

// true si a este Cliente le corresponde el recordatorio ahora mismo (mismo
// criterio que usa el envío real, ver jobs/enviarRecordatorios.js).
function esElegible(cliente) {
  const fechaReceta = cliente.fichaJson?.receta?.fecha;
  if (!fechaReceta || !cliente.telefono) {
    return false;
  }

  const mesesSinControl = mesesDesde(fechaReceta);
  const yaPasaronMeses = mesesSinControl >= MESES_MINIMOS_SIN_CONTROL;
  const noSeHaRecordadoRecien =
    !cliente.recordatorioControlAnualEnviadoEn ||
    diasDesde(cliente.recordatorioControlAnualEnviadoEn) >= DIAS_MINIMOS_ENTRE_RECORDATORIOS;

  return yaPasaronMeses && noSeHaRecordadoRecien;
}

module.exports = {
  MESES_MINIMOS_SIN_CONTROL,
  DIAS_MINIMOS_ENTRE_RECORDATORIOS,
  mesesDesde,
  diasDesde,
  esElegible,
};
