const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Modelo económico y rápido, pensado para alto volumen de conversaciones de WhatsApp.
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Genera la respuesta del chatbot para un mensaje entrante de WhatsApp.
 *
 * @param {Object} params
 * @param {Object} params.empresa - Registro Empresa (incluye nombre, sucursal, rubroTemplate).
 * @param {Array}  params.historial - Mensajes previos de la conversación, formato [{rol, contenido}].
 * @param {string} params.mensajeEntrante - Texto que acaba de escribir el cliente.
 * @returns {Promise<string>} Texto de respuesta del asistente.
 */
async function generarRespuestaChatbot({ empresa, historial, mensajeEntrante }) {
  const nombreEmpresa = empresa.sucursal
    ? `${empresa.nombre} (${empresa.sucursal})`
    : empresa.nombre;

  const serviciosBase = empresa.rubroTemplate?.serviciosBase || [];

  const systemPrompt = `Eres el asistente de agendamiento de "${nombreEmpresa}", vía WhatsApp.
Tu trabajo es ayudar a los clientes a agendar, reagendar o cancelar citas, y responder preguntas
generales sobre los servicios que ofrece el negocio.

Servicios disponibles: ${serviciosBase.length ? serviciosBase.join(', ') : 'consultar con el negocio'}.

Instrucciones:
- Sé breve, cordial y directo — estás en un chat de WhatsApp, no escribas párrafos largos.
- Si el cliente quiere agendar, pide los datos mínimos: servicio deseado, día/horario preferido.
- Si no sabes algo con certeza (ej. disponibilidad real de horarios), no inventes: indica que
  un miembro del equipo lo confirmará.
- No des información médica ni de salud como si fueras un profesional — solo agenda.`;

  // Mapeamos el historial guardado en Conversacion.mensajes al formato que espera la API de Claude.
  const messages = [
    ...historial.map((m) => ({
      role: m.rol === 'asistente' ? 'assistant' : 'user',
      content: m.contenido,
    })),
    { role: 'user', content: mensajeEntrante },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : 'Disculpa, ¿puedes repetir tu mensaje?';
}

module.exports = { generarRespuestaChatbot };
