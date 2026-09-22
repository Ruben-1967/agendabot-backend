// Traduce códigos de error conocidos de la API de WhatsApp (los que llegan
// en el webhook "statuses" cuando un envío falla, ver server.js) a un
// mensaje simple y accionable para el dueño del negocio -- sin jerga
// técnica ni el texto en inglés de Meta. Usado por GET
// /agenda/dashboard/:empresaId para el banner de alerta del panel.

// Solo se incluyen acá los códigos donde la solución es algo que el
// DUEÑO DEL NEGOCIO puede hacer -- otros códigos (ej. 131047, 132000) son
// señales de un problema técnico de nuestro lado, no algo accionable para
// el negocio, así que caen al mensaje genérico de abajo.
const MENSAJES_CONOCIDOS = {
  131042: 'Meta no está entregando tus mensajes de WhatsApp porque tu cuenta no tiene un método de pago cargado. Agrégalo en Meta Business Suite (Facturación y pagos) para que vuelvan a llegar.',
  131026: 'Algunos clientes no pudieron recibir tu mensaje (su número no tiene WhatsApp activo, o rechazaron mensajes del negocio) -- no es un problema de tu cuenta.',
};

function traducirErrorWhatsApp(errorCodigo) {
  if (errorCodigo && MENSAJES_CONOCIDOS[errorCodigo]) {
    return MENSAJES_CONOCIDOS[errorCodigo];
  }
  return 'Meta reportó un problema entregando algunos de tus mensajes de WhatsApp. Si se repite, contacta a soporte.';
}

module.exports = { traducirErrorWhatsApp };
