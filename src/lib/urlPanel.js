// PANEL_FRONTEND_URL puede traer varias URLs separadas por coma — se usa así
// para CORS (ver server.js), donde varios orígenes son válidos a la vez. Pero
// un link que se manda a un cliente (activación de cuenta, retorno de
// Flow.cl) necesita UNA sola URL navegable, no la lista completa pegada con
// comas. Acá siempre se toma la primera, que es la URL de producción real.
function obtenerUrlPanelPrincipal() {
  const valor = process.env.PANEL_FRONTEND_URL;
  if (!valor) return null;
  return valor.split(',')[0].trim();
}

module.exports = { obtenerUrlPanelPrincipal };
