const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { obtenerHorariosDisponibles, crearCita } = require('./disponibilidad');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

const TOOLS = [
  {
    name: 'consultar_disponibilidad',
    description:
      'Consulta los horarios disponibles para agendar una cita en una fecha específica. Devuelve una lista de horas de inicio disponibles (formato HH:MM), o una lista vacía si no hay disponibilidad ese día.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: {
          type: 'string',
          description: "Fecha a consultar, en formato YYYY-MM-DD (ej. '2026-07-15').",
        },
      },
      required: ['fecha'],
    },
  },
  {
    name: 'agendar_cita',
    description:
      'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora y servicio.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha de la cita, formato YYYY-MM-DD.' },
        hora: { type: 'string', description: "Hora de inicio, formato HH:MM (ej. '10:30')." },
        servicio: { type: 'string', description: 'Nombre del servicio solicitado, ej. "Examen de la vista".' },
      },
      required: ['fecha', 'hora', 'servicio'],
    },
  },
];

/**
 * Ejecuta la herramienta pedida por Claude y devuelve el resultado como texto/JSON.
 */
async function ejecutarHerramienta(nombre, input, contexto) {
  const { empresa, cliente, recurso } = contexto;

  if (nombre === 'consultar_disponibilidad') {
    if (!recurso) {
      return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
    }
    const horas = await obtenerHorariosDisponibles(recurso.id, input.fecha);
    return { fecha: input.fecha, horasDisponibles: horas };
  }

  if (nombre === 'agendar_cita') {
    if (!recurso) {
      return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
    }
    const servicioDb = await prisma.servicio.findFirst({
      where: { empresaId: empresa.id, nombre: { equals: input.servicio, mode: 'insensitive' } },
    });

    try {
      const cita = await crearCita({
        empresaId: empresa.id,
        clienteId: cliente.id,
        recursoAgendableId: recurso.id,
        servicioId: servicioDb?.id || null,
        fechaISO: input.fecha,
        horaInicio: input.hora,
      });
      return { exito: true, citaId: cita.id, fecha: input.fecha, hora: input.hora };
    } catch (err) {
      if (err.message === 'HORARIO_YA_NO_DISPONIBLE') {
        return { exito: false, error: 'Ese horario ya no está disponible, ofrece otra alternativa.' };
      }
      throw err;
    }
  }

  return { error: `Herramienta desconocida: ${nombre}` };
}

/**
 * Genera la respuesta del chatbot, permitiéndole usar herramientas reales
 * (consultar disponibilidad, agendar cita) antes de responder en texto.
 *
 * @param {Object} params
 * @param {Object} params.empresa - Empresa (con rubroTemplate incluido).
 * @param {Object} params.cliente - Cliente asociado a esta conversación.
 * @param {Array}  params.historial - Mensajes previos [{rol, contenido}].
 * @param {string} params.mensajeEntrante - Texto del cliente.
 * @returns {Promise<{texto: string, interactivo: Object|null}>}
 */
async function generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante }) {
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;
  const serviciosBase = empresa.rubroTemplate?.serviciosBase || [];

  // Por ahora asumimos un solo RecursoAgendable por empresa (el primero activo).
  // Cuando una empresa tenga varios profesionales, esto deberá preguntarle al
  // cliente cuál prefiere antes de consultar disponibilidad.
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });

  const fechaHoyChile = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

  const systemPrompt = `Eres el asistente de agendamiento de "${nombreEmpresa}", vía WhatsApp.
Hoy es ${fechaHoyChile} (zona horaria de Chile).

Servicios disponibles: ${serviciosBase.length ? serviciosBase.join(', ') : 'consultar con el negocio'}.

Instrucciones:
- Sé breve, cordial y directo — estás en un chat de WhatsApp, no escribas párrafos largos.
- Si el cliente quiere agendar, usa la herramienta consultar_disponibilidad para ver horas REALES antes de ofrecer cualquier horario. NUNCA inventes horas disponibles.
- Una vez que el cliente confirme fecha, hora y servicio específicos, usa agendar_cita para crear la cita de verdad.
- Si agendar_cita falla porque el horario ya no está disponible, discúlpate y ofrece consultar otra hora.
- No des información médica ni de salud como si fueras un profesional — solo agenda.`;

  const messages = [
    ...historial.map((m) => ({
      role: m.rol === 'asistente' ? 'assistant' : 'user',
      content: m.contenido,
    })),
    { role: 'user', content: mensajeEntrante },
  ];

  const contexto = { empresa, cliente, recurso };

  // Bucle de tool use: Claude puede pedir usar una herramienta varias veces
  // seguidas (ej. consultar disponibilidad y luego agendar) antes de dar
  // la respuesta final en texto.
  for (let intentos = 0; intentos < 5; intentos++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return { texto: textBlock ? textBlock.text : 'Disculpa, ¿puedes repetir tu mensaje?', interactivo: null };
    }

    // Guardamos el turno del asistente (incluye los tool_use blocks) y
    // ejecutamos cada herramienta pedida, devolviendo el resultado.
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    let horariosParaMostrar = null;

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const resultado = await ejecutarHerramienta(block.name, block.input, contexto);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(resultado),
        });

        // Si Claude consultó disponibilidad y SÍ hay horas libres, cortamos
        // el ciclo acá: en vez de que Claude las escriba en texto plano, el
        // backend arma una lista interactiva de WhatsApp con las horas
        // reales. Si no hay horas (arreglo vacío), dejamos que el ciclo siga
        // normal para que Claude ofrezca otro día en texto.
        if (block.name === 'consultar_disponibilidad' && resultado.horasDisponibles?.length > 0) {
          horariosParaMostrar = { fecha: resultado.fecha, horas: resultado.horasDisponibles };
        }
      }
    }

    if (horariosParaMostrar) {
      const fechaLegible = new Date(`${horariosParaMostrar.fecha}T00:00:00`).toLocaleDateString('es-CL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Santiago',
      });
      return {
        texto: `Estos son los horarios disponibles para el ${fechaLegible}: ${horariosParaMostrar.horas.join(', ')}. Elige el que más te acomode 👇`,
        interactivo: { tipo: 'lista_horarios', fecha: horariosParaMostrar.fecha, horas: horariosParaMostrar.horas },
      };
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { texto: 'Disculpa, tuve un problema procesando tu solicitud. ¿Puedes intentar de nuevo?', interactivo: null };
}

module.exports = { generarRespuestaChatbot };