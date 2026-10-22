// Precios netos de la suscripción web de Multidigital (sitio web + correos).
// Fuente única: la usan el script que crea los planes en Flow (lo que Flow
// cobra) y el que crea los links (lo que la página le muestra al cliente).
// Si cambian, hay que crear planes nuevos en Flow: el monto de un plan con
// suscripciones activas no se puede editar.
const PRECIOS_NETOS_WEB = { MENSUAL: 9900, ANUAL: 95000 };

module.exports = { PRECIOS_NETOS_WEB };
