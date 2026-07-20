const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { obtenerHorariosDisponibles, crearCita, obtenerProximosDiasConDisponibilidad } = require('./disponibilidad');
const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Arma la lista de herramientas para una empresa específica. Hoy la única
 * variación es que agendar_cita exige el campo "rut" cuando
 * empresa.requiereRut está activo (ej. Ahorróptica) — el resto de las
 * empresas no ven ese campo para nada.
 */
function construirTools(empresa) {
  const agendarCitaProperties = {
    fecha: { type: 'string', description: 'Fecha de la cita, formato YYYY-MM-DD.' },
    hora: { type: 'string', description: "Hora de inicio, formato HH:MM (ej. '10:30')." },
    servicio: { type: 'string', description: 'Nombre del servicio solicitado, ej. "Examen de la vista".' },
  };
  const agendarCitaRequired = ['fecha', 'hora', 'servicio'];

  if (empresa.requiereRut) {
    agendarCitaProperties.rut = {
      type: 'string',
      description: "RUT del cliente (con guión, ej. '12345678-9'). Este negocio exige RUT para agendar.",
    };
    agendarCitaRequired.push('rut');
  }

  return [
    {
      name: 'consultar_disponibilidad',
      description:
        'Consulta los horarios disponibles para agendar una cita en una fecha específica. Devuelve una lista de horas de inicio disponibles (formato HH:MM), o una lista vacía si no hay disponibilidad ese día. Usar cuando el cliente SÍ menciona un día puntual (ej. "el jueves", "mañana", una fecha concreta).',
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
      name: 'consultar_proximos_dias_disponibles',
      description:
        'Consulta los próximos días que tienen al menos un horario disponible, para cuando el cliente quiere agendar pero NO especificó ningún día. Devuelve una lista de días con cupo, cada uno con su hora más temprana disponible. Úsala en vez de consultar_disponibilidad solo cuando el cliente no mencionó fecha.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'agendar_cita',
      description: empresa.requiereRut
        ? 'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora, servicio Y RUT — este negocio exige RUT para agendar.'
        : 'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora y servicio.',
      input_schema: {
        type: 'object',
        properties: agendarCitaProperties,
        required: agendarCitaRequired,
      },
    },
  ];
}

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

  if (nombre === 'consultar_proximos_dias_disponibles') {
    if (!recurso) {
      return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
    }
    const dias = await obtenerProximosDiasConDisponibilidad(recurso.id, 4);
    return { dias: dias.map((d) => ({ fecha: d.fecha, primeraHora: d.horas[0] })) };
  }

  if (nombre === 'agendar_cita') {
    if (!recurso) {
      return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
    }

    // Si la empresa exige RUT, el schema de la herramienta ya lo marca como
    // required — esto es un resguardo extra por si Claude igual la llama sin
    // el campo. Si viene un RUT, lo guardamos en el Cliente (se sobreescribe
    // solo si venía vacío o distinto, así queda actualizado a futuro).
    if (empresa.requiereRut) {
      if (!input.rut) {
        return { error: 'Este negocio exige RUT para agendar. Pide el RUT del cliente antes de reintentar.' };
      }
      if (cliente.rut !== input.rut) {
        await prisma.cliente.update({ where: { id: cliente.id }, data: { rut: input.rut } });
      }
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

  // Preferimos los Servicio reales que la empresa cargó en el panel de
  // Configuración de agenda. Si todavía no cargó ninguno (empresa nueva sin
  // configurar), caemos al listado genérico sugerido por el rubro, para no
  // dejar al bot sin nada que ofrecer mientras tanto.
  const serviciosReales = await prisma.servicio.findMany({
    where: { empresaId: empresa.id, activo: true },
    orderBy: { nombre: 'asc' },
  });
  const serviciosBase = serviciosReales.length > 0
    ? serviciosReales.map((s) => s.nombre)
    : (empresa.rubroTemplate?.serviciosBase || []);

  // Por ahora asumimos un solo RecursoAgendable por empresa (el primero activo).
  // Cuando una empresa tenga varios profesionales, esto deberá preguntarle al
  // cliente cuál prefiere antes de consultar disponibilidad.
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });

  const fechaHoyChile = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

  const tools = construirTools(empresa);

  const bloquesPersonalizacion = [];
  if (empresa.direccion) {
    bloquesPersonalizacion.push(`Dirección del negocio: ${empresa.direccion}`);
  }
  if (empresa.notaAgendamiento) {
    bloquesPersonalizacion.push(`Nota sobre agendamiento (tono/política a transmitir cuando corresponda): ${empresa.notaAgendamiento}`);
  }
  if (empresa.informacionAdicional) {
    bloquesPersonalizacion.push(
      `Información adicional que puedes citar TAL CUAL si el cliente pregunta (precios, promociones, qué incluye cada servicio, etc.) — no agregues ni inventes nada que no esté aquí:\n${empresa.informacionAdicional}`
    );
  }

  const systemPrompt = `Eres el asistente de agendamiento de "${nombreEmpresa}", vía WhatsApp.
Hoy es ${fechaHoyChile} (zona horaria de Chile).

SERVICIOS AGENDABLES (la única lista válida para ofrecer o agendar — nunca agregues, separes ni inventes otros, aunque la información adicional mencione procedimientos o exámenes relacionados):
${serviciosBase.length ? serviciosBase.map((s) => `- ${s}`).join('\n') : '(el negocio no ha cargado servicios todavía — dile al cliente que consulte directamente)'}
${bloquesPersonalizacion.length ? '\n' + bloquesPersonalizacion.join('\n\n') + '\n' : ''}
Instrucciones:
- Sé breve, cordial y directo — estás en un chat de WhatsApp, no escribas párrafos largos.
- Cuando te pregunten qué servicios ofrecen, respondes ÚNICAMENTE con los nombres de la lista "SERVICIOS AGENDABLES" de arriba, tal cual están escritos — nunca los desgloses en sub-procedimientos ni los reemplaces por detalles clínicos.
- Si el cliente usa un término genérico o ambiguo (ej. "atención oftalmológica", "revisión de la vista", "chequeo") que no calza exactamente con ningún nombre de la lista, ayúdalo a elegir agregando junto a cada nombre una explicación MUY breve y en lenguaje simple de qué es ese procedimiento en general (ej. "Toma de agudeza visual: revisa qué tan bien ves de lejos y de cerca") — basándote en tu conocimiento general del área, no en información específica de este negocio. Nunca solo repitas los nombres sin ningún contexto cuando el término del cliente fue genérico.
- Esa explicación es solo DEFINICIÓN de cada procedimiento — nunca le digas al cliente cuál necesita según sus síntomas ni hagas ninguna sugerencia clínica. Que él elija con la información, tú no decides por él.
- El campo "servicio" en agendar_cita/consultar_disponibilidad sigue debiendo ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES, tal cual — la explicación es solo para ayudar a elegir, nunca cambia el nombre real que se agenda.
- La "información adicional" (si existe) es solo para responder preguntas puntuales que el cliente haga (precios, qué incluye un servicio, etc.) — nunca la uses para construir o ampliar la lista de servicios ofrecidos.
- Si el cliente quiere agendar, necesitas saber el SERVICIO antes de mostrar disponibilidad. Si no lo mencionó, pregúntale ÚNICAMENTE el servicio, en un mensaje breve — NUNCA menciones "día", "fecha" ni "cuándo" en ese mensaje.
- En cuanto sepas el servicio (aunque sea en el mismo mensaje en que el cliente te lo dice), tu SIGUIENTE ACCIÓN es obligatoriamente llamar a una herramienta — nunca preguntar en texto si quiere ver los días, nunca ofrecerlo como opción, nunca preguntar "¿qué día te gustaría?". Actúa directo:
  - Si el cliente ya mencionó un día específico en algún momento de la conversación (ej. "el jueves", "mañana", una fecha), usa consultar_disponibilidad con esa fecha, inmediatamente.
  - Si el cliente NO ha mencionado ningún día todavía, usa consultar_proximos_dias_disponibles, inmediatamente, sin preguntar antes si quiere verlos.
- Tienes PROHIBIDO escribir frases como "¿qué día te gustaría?", "¿prefieres que te muestre los días disponibles?" o similares — esa decisión la tomas tú llamando a la herramienta correspondiente, nunca preguntándola en texto.
- NUNCA inventes horas ni días disponibles.
${empresa.requiereRut ? '- Este negocio EXIGE RUT para agendar. Antes de llamar a agendar_cita, además de fecha/hora/servicio, pide el RUT del cliente si aún no lo tienes en la conversación.\n' : ''}- Una vez que el cliente confirme fecha, hora${empresa.requiereRut ? ', servicio y RUT' : ' y servicio'} específicos, usa agendar_cita para crear la cita de verdad. El campo "servicio" debe ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES.
- Si agendar_cita falla porque el horario ya no está disponible, discúlpate y ofrece consultar otra hora.
- Cuando confirmes una cita agendada, NUNCA muestres el "citaId" (es un identificador interno de la base de datos, sin ningún valor para el cliente) — el resumen debe incluir solo servicio, fecha, hora, y dirección si corresponde.
- Si el cliente pregunta algo que no está cubierto en la información de este mensaje (precios, condiciones, detalles clínicos), no inventes: dile que lo puede confirmar directamente con el negocio.
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
      tools,
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
    let diasParaMostrar = null;

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const resultado = await ejecutarHerramienta(block.name, block.input, contexto);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(resultado),
        });

        // Si Claude consultó disponibilidad de UN día y SÍ hay horas libres,
        // cortamos el ciclo acá: en vez de que Claude las escriba en texto
        // plano, el backend arma una lista interactiva de WhatsApp con las
        // horas reales. Si no hay horas (arreglo vacío), dejamos que el
        // ciclo siga normal para que Claude ofrezca otro día en texto.
        if (block.name === 'consultar_disponibilidad' && resultado.horasDisponibles?.length > 0) {
          horariosParaMostrar = { fecha: resultado.fecha, horas: resultado.horasDisponibles };
        }

        // Mismo mecanismo, pero para la lista de PRÓXIMOS DÍAS (cuando el
        // cliente no especificó fecha).
        if (block.name === 'consultar_proximos_dias_disponibles' && resultado.dias?.length > 0) {
          diasParaMostrar = resultado.dias;
        }
      }
    }

    if (horariosParaMostrar) {
      const fechaLegible = fechaLegibleDesdeISO(horariosParaMostrar.fecha);
      return {
        texto: `Estos son los horarios disponibles para el ${fechaLegible}: ${horariosParaMostrar.horas.join(', ')}. Elige el que más te acomode 👇`,
        interactivo: { tipo: 'lista_horarios', fecha: horariosParaMostrar.fecha, horas: horariosParaMostrar.horas },
      };
    }

    if (diasParaMostrar) {
      return {
        texto: 'Estos son los próximos días con horas disponibles. Elige el que más te acomode 👇',
        interactivo: { tipo: 'lista_dias', dias: diasParaMostrar },
      };
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { texto: 'Disculpa, tuve un problema procesando tu solicitud. ¿Puedes intentar de nuevo?', interactivo: null };
}

module.exports = { generarRespuestaChatbot };