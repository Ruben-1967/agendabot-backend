// Varias personas pueden compartir teléfono (familia). Dado el listado de
// Clientes que tienen ese teléfono, devuelve el que corresponde a la persona
// que se está agendando, o null si es otra persona (hay que crearle su propio
// Cliente). Así sus recetas, ficha y recordatorios de control no se mezclan
// con los de otra persona del mismo número (reporte Ahorróptica, 2026-10-27).
//
// Mismo nombre con RUT distinto se trata como la misma persona (RUT
// corregido o mal tipeado); sin RUT en alguno de los dos, se reusa el Cliente.

function normalizarNombre(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function elegirClientePorTelefono(candidatos, rut, nombre) {
  return candidatos.find((c) => {
    if (!rut || !c.rut || c.rut === rut) return true;
    return normalizarNombre(c.nombre) === normalizarNombre(nombre);
  }) || null;
}

module.exports = { elegirClientePorTelefono, normalizarNombre };
