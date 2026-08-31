// Normaliza un RUT chileno a "12345678-9" (sin puntos, dígito verificador
// en mayúscula) para que el mismo rut siempre quede escrito igual en la
// base de datos — el dedupe de pacientes (ver POST /agenda/citas) compara
// por igualdad exacta de string, así que "12.345.678-9" y "12345678-9"
// deben terminar siendo el mismo valor guardado.
//
// No valida dígito verificador, solo formato (7-8 dígitos + guión + dígito
// o K) — suficiente para descartar basura evidente (texto libre, ids, JSON)
// sin rechazar un RUT real por un error de cálculo del dígito.
function normalizarRut(rutCrudo) {
  return String(rutCrudo).replace(/[.\s]/g, '').toUpperCase();
}

function esRutValido(rutNormalizado) {
  return /^\d{7,8}-[\dK]$/.test(rutNormalizado);
}

module.exports = { normalizarRut, esRutValido };
