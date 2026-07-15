// Tarifas reales de Meta para WhatsApp Business, mercado Chile, en CLP por
// mensaje — confirmadas directamente en la calculadora oficial
// (https://whatsappbusiness.com/products/platform-pricing/) el 14 de julio
// de 2026. Actualizar aquí si Meta cambia las tarifas (lo hace como máximo
// una vez por trimestre: 1 de enero/abril/julio/octubre).
//
// Sirven para estimar el costo real de un envío ANTES de dispararlo, ya que
// el envío proactivo del catálogo rotativo no cae en la ventana de servicio
// gratuita (el negocio inicia la conversación, no el cliente).

const TARIFAS_WHATSAPP_CLP = {
  SERVICIO: 0,        // respuestas dentro de la ventana de 24h — gratis
  UTILITY: 17.6584,   // ej. recordatorio de control anual (transaccional)
  AUTENTICACION: 17.6584,
  MARKETING: 78.4917, // ej. aviso de catálogo del día — es contenido promocional
};

// El aviso de catálogo rotativo ("hoy tenemos esto disponible, ¿pedimos?")
// es contenido promocional, no una respuesta a una transacción existente —
// Meta lo clasifica como MARKETING, la tarifa más alta de la tabla.
const TARIFA_CAMPANA_CATALOGO_CLP = TARIFAS_WHATSAPP_CLP.MARKETING;

module.exports = { TARIFAS_WHATSAPP_CLP, TARIFA_CAMPANA_CATALOGO_CLP };
