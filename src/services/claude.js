const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const {
  obtenerHorariosDisponiblesPorBloque,
  obtenerProximosDiasConDisponibilidad,
  obtenerHorasDisponiblesPorBloqueParaServicio,
  obtenerProximosDiasParaServicio,
  resolverServicioParaHerramienta,
  normalizarYValidarRut,
} = require('./disponibilidad');
const { siguientePaso, PLANTILLAS_DETERMINISTAS } = require('./flujoReserva');

// El texto que acompaña la lista de "próximos días" es fijo (ver más abajo,
// no lo redacta el modelo) — así que una instrucción del system prompt
// pidiendo aclarar cuando el día puntual preguntado no está disponible
// NUNCA podía tener efecto ahí, por diseño. Reproducido en vivo 2026-09-01
// (reporte real de Ahorróptica): cliente pregunta "¿tienen domingo?", el
// bot solo reenvía la lista de viernes reales sin aclarar que domingo no
// está — un cliente que no la revise con atención puede pensar que sí se
// ofreció. Este heurístico detecta el nombre de un día de semana en el
// último mensaje del cliente y, si ese día no aparece en los resultados
// reales, lo aclara antes de mostrar la lista.
const DIAS_SEMANA_SINGULAR = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_SEMANA_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

// Bug real reportado (Ahorróptica, 2026-09-15): el cliente escribe en
// texto libre el nombre EXACTO de un servicio real recién mostrado en la
// lista (ej. "Evaluación examen visual" — el único servicio real de ese
// negocio) y el modelo, en vez de proceder, vuelve a llamar a
// mostrar_lista_servicios — pese a tener ese nombre exacto tanto en su
// propio contexto (SERVICIOS AGENDABLES) como en el mensaje del cliente.
// Es una falla de confiabilidad del modelo, no un problema de datos (Meta/
// Anthropic documentan que incluso con tool_choice forzado el modelo puede
// decidir mal la herramienta) — mismo principio que las demás heurísticas
// de esta familia: no confiar en que el modelo lo resuelva solo, detectar
// el calce exacto (normalizado) del mensaje del cliente contra los
// Servicio reales.
function normalizarNombreServicio(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .trim();
}

// Si además el mismo mensaje menciona un día, no forzamos nada acá —
// dejamos que el ciclo normal de Claude decida (podría necesitar
// consultar_disponibilidad con esa fecha en vez de
// consultar_proximos_dias_disponibles), evitando forzar la herramienta
// equivocada para ese caso menos común.
function mensajeNombraServicioExactoSinDia(mensaje, serviciosReales) {
  const normalizado = normalizarNombreServicio(mensaje);
  if (!normalizado) return null;
  const mencionaDia = DIAS_SEMANA_SINGULAR.some((d) => normalizado.includes(d)) || /\d{1,2}[\/-]\d{1,2}/.test(normalizado);
  if (mencionaDia) return null;
  return (serviciosReales || []).find((s) => normalizarNombreServicio(s.nombre) === normalizado) || null;
}

function diaSemanaDesdeFechaISO(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

function armarTextoProximosDias(mensajeEntrante, dias) {
  const textoNormalizado = (mensajeEntrante || '').toLowerCase();
  const diasEnResultado = new Set(dias.map((d) => diaSemanaDesdeFechaISO(d.fecha)));

  for (let i = 0; i < DIAS_SEMANA_SINGULAR.length; i++) {
    if (textoNormalizado.includes(DIAS_SEMANA_SINGULAR[i]) && !diasEnResultado.has(i)) {
      return `No tenemos atención los ${DIAS_SEMANA_PLURAL[i]}, pero sí tenemos disponible 👇`;
    }
  }

  return 'Estos son los próximos días con horas disponibles. Elige el que más te acomode 👇';
}

const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');
const { MAX_FILAS_LISTA_INTERACTIVA } = require('./whatsapp');

/**
 * Arma {texto, interactivo} para una lista de horarios disponibles de UN
 * día -- extraído del bloque `horariosParaMostrar` de
 * generarRespuestaChatbotSinCorregirVoseo (más abajo) para que el camino de
 * tap determinístico (chatbotEngine.js#procesarSeleccionInteractiva, fix
 * estructural 2026-09-17) use exactamente la misma lógica de formato/
 * truncamiento, sin mantener 2 copias que se puedan desincronizar.
 *
 * @param {string} fecha - 'YYYY-MM-DD'
 * @param {string[]} horas
 * @param {{horaInicio: string, horaFin: string, horas: string[]}[]} bloques
 * @returns {{texto: string, interactivo: Object}}
 */
/**
 * Divide los bloques reales de un día en RANGOS de a lo más
 * MAX_FILAS_LISTA_INTERACTIVA horas cada uno, sin mezclar horas de bloques
 * distintos (ej. mañana y tarde separados por un break). Dentro de un
 * bloque se reparten de forma pareja (18 horas -> 2 rangos de 9, no 10 + 8).
 *
 * @param {{horas: string[]}[]} bloques
 * @returns {{desde: string, hasta: string, horas: string[]}[]}
 */
function dividirEnFranjas(bloques) {
  const franjas = [];
  for (const bloque of bloques) {
    const horas = bloque.horas;
    if (horas.length === 0) continue;
    const cantidad = Math.ceil(horas.length / MAX_FILAS_LISTA_INTERACTIVA);
    const tamano = Math.ceil(horas.length / cantidad);
    for (let i = 0; i < horas.length; i += tamano) {
      const grupo = horas.slice(i, i + tamano);
      franjas.push({ desde: grupo[0], hasta: grupo[grupo.length - 1], horas: grupo });
    }
  }
  return franjas;
}

function armarRespuestaHorarios(fecha, horas, bloques) {
  const fechaLegible = fechaLegibleDesdeISO(fecha);

  // Caso de siempre: todas las horas del día caben en UNA lista interactiva
  // de WhatsApp — Meta limita esa lista a MAX_FILAS_LISTA_INTERACTIVA filas
  // en total (ver whatsapp.js). Incluye el día con break (mañana y tarde)
  // cuando entre los dos bloques no pasan de ese tope.
  if (horas.length <= MAX_FILAS_LISTA_INTERACTIVA) {
    return {
      texto: `Estos son los horarios disponibles para el ${fechaLegible}: ${horas.join(', ')}. Elige el que más te acomode 👇`,
      interactivo: { tipo: 'lista_horarios', fecha, horas },
    };
  }

  // Más horas que filas posibles: en vez de truncar a 10 y esconder horas
  // reales, o de mandar un texto largo para que el cliente teclee la hora
  // (lo que se hacía desde 2026-09-03 y Ahorróptica pidió cambiar el
  // 2026-10-06: quieren la lista tocable siempre), se muestra primero una
  // lista de RANGOS ("09:00 a 11:15") y, al tocar uno, la lista de horas de
  // ese rango. Nada queda oculto: todas las horas siguen siendo tocables, y
  // el cliente que prefiera escribir la hora igual puede (ver
  // opcionesMostradas en chatbotEngine.js).
  const franjas = dividirEnFranjas(bloques);
  if (franjas.length <= MAX_FILAS_LISTA_INTERACTIVA) {
    return {
      texto: `Hay ${horas.length} horarios disponibles para el ${fechaLegible}. Primero elige el rango de horas que más te acomode 👇`,
      interactivo: { tipo: 'lista_franjas', fecha, franjas },
    };
  }

  // Caso extremo (más de 100 horas en un día): se manda el listado completo
  // en texto plano, un mensaje por bloque, sin lista interactiva. El corte de
  // bloques sale directo del horario real configurado, no de un corte fijo a
  // las 12:00. Pedido por Ahorróptica 2026-09-03.
  const bloquesEtiquetados = bloques.map((b) => ({
    ...b,
    etiqueta: Number(b.horaInicio.split(':')[0]) < 12 ? 'la mañana' : 'la tarde',
  }));
  const texto = bloquesEtiquetados
    .map((b) => `Estos son los horarios disponibles en ${b.etiqueta} para el ${fechaLegible}: ${b.horas.join(', ')}.`)
    .join('\n\n') + '\n\n¿Cuál te acomoda? Escríbeme la hora que prefieras.';

  return {
    texto,
    interactivo: { tipo: 'horarios_por_bloque', fecha, bloques: bloquesEtiquetados },
  };
}

/**
 * Arma {texto, interactivo} para una lista de próximos días con
 * disponibilidad -- extraído del bloque `diasParaMostrar`, mismo motivo que
 * armarRespuestaHorarios. `mensajeEntrante` es opcional (null desde el
 * camino de tap, que no tiene un mensaje de texto que revisar) -- solo se
 * usa para la aclaración de "no atendemos los domingos" (ver
 * armarTextoProximosDias).
 *
 * @param {{fecha: string, horas: string[]}[]} dias
 * @param {string|null} [mensajeEntrante]
 * @returns {{texto: string, interactivo: Object}}
 */
function armarRespuestaProximosDias(dias, mensajeEntrante = null) {
  return {
    texto: armarTextoProximosDias(mensajeEntrante, dias),
    interactivo: { tipo: 'lista_dias', dias },
  };
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Sonnet 5 en vez de Haiku 4.5 (2026-09-16) -- decisión tomada con el
// usuario tras varias sesiones corrigiendo la misma clase de falla de
// confiabilidad del modelo (menús inventados, confirmaciones sin agendar,
// voseo pese a instrucción estricta, servicio exacto no reconocido, etc.).
// Las heurísticas/redes de seguridad de este archivo se quedan igual --
// un modelo mejor reduce cuánto disparan, no reemplaza la necesidad de
// tenerlas.
const MODEL = 'claude-sonnet-5';
// Sonnet 5 piensa por defecto (thinking adaptativo) y esos tokens cuentan contra
// max_tokens: si se los come todos, la respuesta vuelve sin texto. Visto en
// producción el 2026-10-24 (primer interesado real de Colombia): 1500 de 1500 en
// thinking, stop_reason max_tokens, y el cliente recibió "¿puedes repetir?".
// Es un techo, no un gasto: se cobra solo lo que el modelo usa.
const MAX_TOKENS_RESPUESTA = 4000;

// Prompt caching (2026-10-24). Las instrucciones (tools + system) son iguales en cada
// mensaje de un mismo negocio: solo cambian la fecha (una vez al día) y, en el guion, el
// saludo según la hora. Se marcan 2 puntos de caché: el system (cachea tools + system) y
// el último mensaje (cachea el historial, que en el turno siguiente es el mismo prefijo).
// Lo leído del caché se cobra ~0,1x; escribirlo, 1,25x. Dura 5 min desde el último uso.
// Mínimo cacheable en Sonnet 5: 1024 tokens (los prompts de acá pasan de 3.000).
const CACHE_EFIMERO = { type: 'ephemeral' };
function sistemaConCache(systemPrompt) {
  return [{ type: 'text', text: systemPrompt, cache_control: CACHE_EFIMERO }];
}
// Copia de messages con el punto de caché en el último bloque. No toca el array original
// (los ciclos de herramientas siguen agregándole turnos) y solo hay un punto por llamada.
function mensajesConCache(messages) {
  if (!messages.length) return messages;
  const ultimo = messages[messages.length - 1];
  const bloques = typeof ultimo.content === 'string'
    ? [{ type: 'text', text: ultimo.content }]
    : ultimo.content.map((b) => ({ ...b }));
  if (!bloques.length) return messages;
  bloques[bloques.length - 1] = { ...bloques[bloques.length - 1], cache_control: CACHE_EFIMERO };
  return [...messages.slice(0, -1), { ...ultimo, content: bloques }];
}
// LOG_CACHE=1 (ej. en la Shell de staging) muestra cuánto se leyó/escribió del caché.
function registrarUsoCache(etiqueta, response) {
  if (process.env.LOG_CACHE !== '1') return;
  const u = response.usage || {};
  console.log(`[CACHE ${etiqueta}] leído=${u.cache_read_input_tokens || 0} escrito=${u.cache_creation_input_tokens || 0} sin caché=${u.input_tokens || 0}`);
}

// Texto fijo de la pregunta de servicios (nunca lo redacta el modelo, ver
// mostrar_lista_servicios más abajo) y su variante para cuando ya se
// preguntó antes en la misma conversación sin que el cliente eligiera del
// menú — ver comentario en el bloque "serviciosParaMostrar".
const TEXTO_PREGUNTA_SERVICIOS = '¿Para cuál de estos servicios necesitas la hora? 👇';
// Bug real reportado (2026-09-17): esta variante ANTES saludaba por
// nombre ("¡Perfecto, [nombre]!"), usando Cliente.nombre -- pero en este
// punto de la conversación esa columna NUNCA es confiable todavía
// (agendar_cita, que sí guarda el nombre real que el cliente acaba de
// decir, todavía no se ejecutó): puede ser el nombre de perfil de
// WhatsApp de quien sea que esté escribiendo (visto en producción:
// "¡Perfecto, Luxvision!" para una clienta real llamada Rosa Levi, porque
// el teléfono de prueba tenía ese perfil) o un placeholder de test. Mismo
// principio que ya aplica en agendar_cita: nunca asumir el nombre de
// perfil de WhatsApp del contacto. Se saca el nombre por completo.
const SUFIJO_PREGUNTA_SERVICIOS_REPETIDA = '¿Podrías elegir uno de estos servicios del menú de arriba? 👇';
const TEXTO_PREGUNTA_SERVICIOS_REPETIDA = `¡Perfecto! ${SUFIJO_PREGUNTA_SERVICIOS_REPETIDA}`;
// Para detectar si el turno anterior ya fue esta pregunta, comparamos por
// el sufijo fijo
// en vez de por igualdad exacta contra la función.
const esPreguntaDeServiciosRepetida = (texto) => (texto || '').endsWith(SUFIJO_PREGUNTA_SERVICIOS_REPETIDA);

/**
 * Arma la lista de herramientas para una empresa específica.
 * - agendar_cita NO está acá -- desde el paso 9 del fix estructural
 *   (2026-09-17), Claude ya no tiene ninguna forma de crear una cita
 *   directamente. La creación real siempre pasa por crearCitaValidada
 *   (disponibilidad.js), disparada de forma determinística en el backend
 *   (tap, fast-path de texto exacto, o extracción acotada de RUT/teléfono
 *   -- ver chatbotEngine.js) en el momento exacto en que reservaEnCurso
 *   queda completa. Estas herramientas de acá solo ayudan a MOSTRAR
 *   disponibilidad/servicios/catálogo -- nunca a decidir ni confirmar un
 *   agendamiento.
 * - mostrar_lista_servicios solo se incluye si la empresa tiene Servicio
 *   reales cargados (con id de base de datos) — si solo tiene la lista
 *   genérica sugerida por el rubro (sin ids reales), no se puede armar una
 *   lista interactiva de WhatsApp con eso, así que Claude sigue preguntando
 *   el servicio en texto en ese caso.
 * - mostrar_catalogo_visual solo se incluye si empresa.catalogoVisualActivo
 *   está prendido Y la empresa tiene categorías con al menos un item activo
 *   (nunca se le asume al modelo, ver generarRespuestaChatbot).
 */
function construirTools(empresa, incluirMostrarServicios, incluirCatalogo) {
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
          servicio: {
            type: 'string',
            description: 'Nombre del servicio que el cliente quiere agendar, exactamente uno de los nombres de la lista SERVICIOS AGENDABLES.',
          },
        },
        required: ['fecha', 'servicio'],
      },
    },
{
      name: 'consultar_proximos_dias_disponibles',
      description:
        'Consulta los próximos días que tienen al menos un horario disponible, para cuando el cliente quiere agendar pero NO especificó ningún día. Devuelve una lista de días con cupo, cada uno con su hora más temprana disponible. Úsala en vez de consultar_disponibilidad solo cuando el cliente no mencionó fecha.',
      input_schema: {
        type: 'object',
        properties: {
          servicio: {
            type: 'string',
            description: 'Nombre del servicio que el cliente quiere agendar, exactamente uno de los nombres de la lista SERVICIOS AGENDABLES.',
          },
        },
        required: ['servicio'],
      },
    },
    ...(incluirMostrarServicios ? [{
      name: 'mostrar_lista_servicios',
      description:
        'Muestra al cliente la lista de servicios reales disponibles, como opciones tocables para elegir. Úsala SIEMPRE que el cliente pregunte qué servicios/atenciones ofrece el negocio — tanto si lo pregunta de forma informativa (ej. "servicios", "qué atienden", "qué hacen") como si quiere agendar y todavía no sabes cuál servicio específico necesita. En ambos casos, nunca respondas esa lista en texto plano.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    }] : []),
    ...(incluirCatalogo ? [{
      name: 'mostrar_catalogo_visual',
      description:
        'Muestra al cliente fotos reales de una categoría del catálogo visual del negocio (ej. cortes de pelo, armazones, tratamientos, platos). Llámala SOLO cuando el cliente ya confirmó que quiere ver las fotos — sea porque respondió que sí a tu oferta en texto, o porque las pidió directamente él mismo, en cualquier momento de la conversación (incluso con el agendamiento ya iniciado). NUNCA la uses solo para preguntar si quiere verlas — esa oferta se hace en texto plano primero. El campo "categoria" debe ser exactamente uno de los nombres de la lista CATEGORÍAS DE CATÁLOGO VISUAL DISPONIBLES.',
      input_schema: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description: 'Nombre exacto de la categoría, tal como aparece en la lista CATEGORÍAS DE CATÁLOGO VISUAL DISPONIBLES.',
          },
          pagina: {
            type: 'integer',
            description: 'Página de resultados (4 imágenes por página). Usar 1 la primera vez; si el cliente pide ver más después de que se lo preguntaste, volver a llamar con la página siguiente (2, 3, ...).',
          },
        },
        required: ['categoria'],
      },
    }] : []),
    {
      name: 'escalar_a_humano',
      description: 'Úsala cuando el cliente pide explícitamente hablar con una persona real, un ejecutivo, un humano, o dice que no quiere seguir hablando con un bot/asistente automático. Pausa las respuestas automáticas para que alguien del negocio le responda directamente. NO la uses para preguntas normales que tú mismo puedes responder — solo cuando el cliente pide explícitamente ser atendido por una persona.',
      input_schema: { type: 'object', properties: {} },
    },
  ];
}

/**
 * Ejecuta la herramienta pedida por Claude y devuelve el resultado como texto/JSON.
 */
async function ejecutarHerramienta(nombre, input, contexto) {
  const { empresa, cliente, recurso, serviciosReales } = contexto;

  if (nombre === 'consultar_disponibilidad') {
    const resuelto = await resolverServicioParaHerramienta(empresa, recurso, input.servicio);
    // servicioId/servicioNombre viajan en el resultado (no solo se usan acá
    // y se descartan) -- bug real encontrado en review 2026-09-17: cuando
    // Claude nombra el servicio y llama directo a esta tool (sin pasar por
    // mostrar_lista_servicios, que es justo lo que el prompt le pide hacer
    // en ese caso), el backend necesita poder sembrar
    // reservaEnCurso.servicioId igual que si el cliente lo hubiera tocado
    // (ver conOpcionesDelPipelineAgentico, chatbotEngine.js) -- si no, un
    // negocio con 2+ servicios reales queda con PEDIR_SERVICIO pendiente y
    // la siguiente hora/día que el cliente escriba se malinterpreta como
    // si fuera el nombre del servicio.
    const servicioResuelto = { servicioId: resuelto.servicioDb?.id || null, servicioNombre: resuelto.servicioDb?.nombre || input.servicio || null };
    if (resuelto.usaProfesionalFijo) {
      if (!resuelto.recursoId) {
        return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
      }
      const bloques = await obtenerHorariosDisponiblesPorBloque(resuelto.recursoId, input.fecha);
      return { fecha: input.fecha, horasDisponibles: bloques.flatMap((b) => b.horas), bloques, ...servicioResuelto };
    }
    const bloques = await obtenerHorasDisponiblesPorBloqueParaServicio(resuelto.servicioDb.id, input.fecha);
    return { fecha: input.fecha, horasDisponibles: bloques.flatMap((b) => b.horas), bloques, ...servicioResuelto };
  }

  if (nombre === 'consultar_proximos_dias_disponibles') {
    const resuelto = await resolverServicioParaHerramienta(empresa, recurso, input.servicio);
    const servicioResuelto = { servicioId: resuelto.servicioDb?.id || null, servicioNombre: resuelto.servicioDb?.nombre || input.servicio || null };
    let dias;
    if (resuelto.usaProfesionalFijo) {
      if (!resuelto.recursoId) {
        return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
      }
      dias = await obtenerProximosDiasConDisponibilidad(resuelto.recursoId, 7);
    } else {
      dias = await obtenerProximosDiasParaServicio(resuelto.servicioDb.id, 7);
    }
    return { dias: dias.map((d) => ({ fecha: d.fecha, primeraHora: d.horas[0] })), ...servicioResuelto };
  }

  if (nombre === 'mostrar_lista_servicios') {
    return { servicios: (serviciosReales || []).map((s) => ({ id: s.id, nombre: s.nombre })) };
  }

  if (nombre === 'mostrar_catalogo_visual') {
    const TAMANO_PAGINA = 4;
    const pagina = Number.isInteger(input.pagina) && input.pagina > 0 ? input.pagina : 1;

    const categoriaDb = await prisma.catalogoCategoria.findFirst({
      where: { empresaId: empresa.id, nombre: { equals: input.categoria, mode: 'insensitive' } },
    });
    if (!categoriaDb) {
      return { error: 'No encontramos esa categoría del catálogo.' };
    }

    const itemsActivos = await prisma.catalogoItem.findMany({
      where: { categoriaId: categoriaDb.id, activo: true },
      orderBy: { creadoEn: 'asc' },
    });

    const inicio = (pagina - 1) * TAMANO_PAGINA;
    const itemsPagina = itemsActivos.slice(inicio, inicio + TAMANO_PAGINA);

    return {
      categoria: categoriaDb.nombre,
      items: itemsPagina.map((i) => ({ nombre: i.nombre, imagenUrl: i.imagenUrl })),
      totalActivos: itemsActivos.length,
      mostrados: inicio + itemsPagina.length,
    };
  }

  if (nombre === 'escalar_a_humano') {
    // No escribe nada en la base acá — generarRespuestaChatbot() señala
    // escaladoAHumano:true en su resultado, y quien la llama
    // (chatbotEngine.js) es el único lugar que ya maneja el ciclo de vida
    // de la Conversacion, así que ahí es donde se pausa de verdad.
    return { exito: true };
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
/**
 * Bloque A del system prompt (identidad/tono) -- extraído para poder
 * reusarlo tal cual desde 2 lugares: el prompt agéntico completo de abajo
 * (con tools) y redactarMensajePaso() (solo redactar, sin tools, ver fix
 * estructural 2026-09-17). Sin cambios de contenido respecto al bloque
 * inline que reemplaza.
 *
 * @param {Object} empresa
 * @returns {string}
 */
function construirBloqueIdentidad(empresa) {
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;

  // Se incluye el día de la semana YA CALCULADO (no solo la fecha numérica)
  // porque dejar que el modelo calcule qué día de semana corresponde a una
  // fecha es exactamente el mismo tipo de error que ya causó una
  // confirmación de cita con el día equivocado — el bot dijo "hoy es
  // martes" estando en miércoles. Reportado por Ahorróptica, 2026-09-02.
  const fechaHoyChile = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const tono = empresa.tonoComunicacion || 'Neutral';
  const instruccionesTono = {
    'Formal': 'Mantén un tono profesional y respetuoso. Usa usted, estructura las frases con cuidado, sé conciso y formal.',
    'Neutral': 'Usa un tono equilibrado — profesional pero cercano, tuteo es OK, sé breve y directo.',
    'Informal': 'Usa un tono conversacional y cercano. Sé amigable, puedes usar emojis ocasionales (no abuses), sé relajado pero siempre profesional.',
  };

  return `Eres el asistente de agendamiento de "${nombreEmpresa}", vía WhatsApp.
Hoy es ${fechaHoyChile} (zona horaria de Chile).

TONO DE COMUNICACIÓN:
${instruccionesTono[tono] || instruccionesTono['Neutral']}
Este tono aplica a TODA tu comunicación, incluida la interpretación de la "información adicional" que pueda estar cargada. Cuando cites información sobre precios, promociones o detalles del servicio, adáptalo al tono especificado sin cambiar su contenido.
REGLA ESTRICTA E INQUEBRANTABLE, sin excepción para ningún tono (incluido Informal): SIEMPRE tutea ("tú", "tienes", "puedes", "quieres", "necesitas"), NUNCA vosees. Español neutro de Chile, jamás "vos", "tenés", "querés", "necesitás", "podés", "andá", "fijate", ni ninguna otra conjugación de voseo — aunque el cliente mismo te escriba en voseo, tú SIEMPRE respondes en tuteo.`;
}

/**
 * Texto fijo de confirmación de una cita YA agendada de verdad -- nunca lo
 * redacta el modelo (bug real encontrado con el cliente "yaye" 2026-09-01,
 * cuando todavía existía agendar_cita como tool: Claude narraba la
 * confirmación en texto sin haber agendado nada). Desde el paso 9 del fix
 * estructural, Claude ya no puede agendar en absoluto -- esta función es
 * la ÚNICA fuente del texto de confirmación, usada por
 * chatbotEngine.js#procesarSeleccionInteractivaSinLock (tap, fast-path de
 * texto, y extracción de RUT/teléfono), para que nunca haya 2 copias que
 * se puedan desincronizar.
 *
 * @param {Object} datos - {nombre, servicioNombre, fechaLegible, hora, empresa}
 * @returns {string}
 */
function formatearConfirmacionCita({ nombre, servicioNombre, fechaLegible, hora, empresa }) {
  return `¡Listo! Tu cita ha sido agendada exitosamente 🎉\n\n*Resumen de tu cita:*\n👤 *Nombre:* ${nombre}\n📋 *Servicio:* ${servicioNombre}\n📅 *Fecha:* ${fechaLegible}\n🕐 *Hora:* ${hora}${empresa.direccion ? `\n📍 *Ubicación:* ${empresa.direccion}` : ''}${empresa.notaAgendamiento ? `\n\n${empresa.notaAgendamiento}` : ''}`;
}

// Bloque B ("solo redactar") por paso -- qué pedirle a Claude que redacte,
// nunca qué decidir (eso ya lo decidió el backend con certeza, ver
// flujoReserva.js#siguientePaso). Usado por redactarMensajePaso más abajo.
const INSTRUCCIONES_REDACCION_POR_PASO = {
  PEDIR_SERVICIO: 'Pide amablemente que elija uno de los servicios del menú que ya se le mostró -- NUNCA los enumeres tú en texto, el menú interactivo ya se mostró por separado.',
  PEDIR_DIA: 'Pregunta brevemente qué día le gustaría agendar.',
  PEDIR_HORA: 'Pregunta brevemente a qué hora le gustaría agendar, dado el día que ya aparece confirmado en el ESTADO ACTUAL.',
  PEDIR_NOMBRE: 'Pide el nombre completo de la persona que se va a atender -- nunca asumas el nombre de perfil de WhatsApp, puede ser distinto de quien escribe (ej. agendando para un familiar).',
  PEDIR_RUT: 'Pide el RUT (con guión, ej. 12345678-9) y un teléfono de contacto -- nunca asumas el teléfono desde el que te escribe.',
  CONFIRMAR: 'Recapitula fecha, hora, servicio y nombre (y RUT/teléfono si aparecen en el ESTADO ACTUAL) usando TAL CUAL esos valores -- nunca los recalcules, nunca cambies su formato -- y pide una confirmación final antes de agendar.',
};

/**
 * Bloque B: llama a Claude SIN herramientas, únicamente para redactar el
 * próximo mensaje al cliente -- el backend ya decidió con certeza qué paso
 * sigue (reservaEnCurso + siguientePaso, ver flujoReserva.js), Claude nunca
 * vuelve a decidir el flujo acá, solo elige las palabras. Parte del fix
 * estructural 2026-09-17: reemplaza, para las transiciones ya deterministas
 * (tap decodificado, o texto que calzó exacto con una opción mostrada), el
 * pipeline agéntico completo que hasta ahora tenía que re-derivar todo el
 * estado desde el historial en texto plano.
 *
 * @param {Object} params
 * @param {Object} params.empresa
 * @param {Object|null} params.reservaEnCurso - Conversacion.reservaEnCurso.
 * @param {string} params.paso - Una de las claves de flujoReserva.PASOS.
 * @param {string} [params.mensajeEntrante] - Último mensaje del cliente en este turno, si lo hay.
 * @returns {Promise<string|null>} El texto redactado (con voseo ya corregido), o null si el turno no devolvió texto utilizable -- el caller debe usar PLANTILLAS_DETERMINISTAS[paso] en ese caso, nunca un mensaje genérico de error.
 */
async function redactarMensajePaso({ empresa, reservaEnCurso, paso, mensajeEntrante }) {
  const bloqueEstado = `ESTADO ACTUAL DE LA RESERVA (ya confirmado con certeza por el sistema -- nunca lo vuelvas a preguntar ni a poner en duda, ni inventes ni cambies ninguno de estos valores):
${JSON.stringify(reservaEnCurso || {}, null, 2)}

PASO ACTUAL: ${paso}`;

  const systemPrompt = `${construirBloqueIdentidad(empresa)}

MODO: SOLO REDACTAR. No tienes herramientas disponibles en este turno -- tu única tarea es escribir el próximo mensaje para el cliente, breve y natural, acorde al PASO ACTUAL de abajo. Nunca inventes datos, nunca vuelvas a preguntar ni a mostrar algo que ya aparece en el ESTADO ACTUAL DE LA RESERVA, nunca ofrezcas ni actúes como si tuvieras herramientas disponibles.
${INSTRUCCIONES_REDACCION_POR_PASO[paso] || INSTRUCCIONES_REDACCION_POR_PASO.CONFIRMAR}

${bloqueEstado}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    // Prompt mucho más corto que el agéntico completo (sin tools, sin
    // historial) -- 600 deja margen de sobra para el thinking adaptativo de
    // Sonnet 5 sin repetir el bug real de max_tokens insuficiente que ya
    // afectó al prompt completo (ver comentario en el ciclo principal, más
    // abajo).
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: mensajeEntrante || '(el cliente no escribió texto en este turno -- ej. recién tocó un botón)' }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const texto = textBlock ? textBlock.text : '';

  if (!texto) {
    console.error(
      '[claude.js] redactarMensajePaso sin texto -- stop_reason:', response.stop_reason,
      '| paso:', paso, '| usage:', JSON.stringify(response.usage)
    );
    return null;
  }

  return corregirVoseo(texto);
}

/**
 * Extracción ACOTADA de RUT y/o teléfono de contacto desde texto libre --
 * paso 9 del fix estructural (decisión 2026-09-17, ver
 * C:\Users\ruben\.claude\plans\clever-yawning-stearns.md): PEDIR_RUT
 * deliberadamente no tiene fast-path por regex (paso 8, un mensaje corto
 * rara vez trae ambos datos de forma inequívoca), pero una vez que
 * agendar_cita deja de ser una tool de Claude, el pipeline completo ya no
 * tiene forma de agendar -- así que hace falta ALGO que capture estos 2
 * campos sin volver a caer en el patrón que motivó todo este refactor
 * (Claude decidiendo el flujo completo). Esta función usa Claude con UNA
 * SOLA herramienta, que SOLO puede registrar los 2 campos puntuales que
 * el cliente haya mencionado explícitamente -- nunca decide el siguiente
 * paso, nunca agenda, nunca ofrece ninguna otra acción. El backend valida
 * el RUT extraído (normalizarYValidarRut) antes de confiar en él.
 *
 * @param {Object} params
 * @param {Object} params.empresa
 * @param {Object|null} params.reservaEnCurso
 * @param {string} params.mensajeEntrante
 * @returns {Promise<{rut: string|null, rutInvalido: string|null, telefono: string|null, texto: string|null}>} texto viene lleno SOLO cuando Claude no encontró ninguno de los 2 datos y respondió en texto en su lugar (ej. resolvió una duda puntual) -- en ese caso rut/telefono son null y el caller usa ese texto tal cual. rutInvalido viene lleno (tal cual lo escribió el cliente) cuando SÍ mencionó un RUT pero no tiene formato válido -- distinto de "no lo mencionó" (rut y rutInvalido ambos null), para poder darle feedback específico.
 */
async function extraerRutYTelefono({ empresa, reservaEnCurso, mensajeEntrante }) {
  const systemPrompt = `${construirBloqueIdentidad(empresa)}

MODO: EXTRAER UN DATO PUNTUAL. No tienes ninguna otra herramienta disponible en este turno -- tu única tarea es revisar el mensaje del cliente y, SOLO si menciona explícitamente su RUT y/o su teléfono de contacto, llamar a extraer_rut_y_telefono con lo que hayas encontrado (puedes dejar un campo vacío si no lo mencionó). Nunca inventes ni asumas ninguno de los 2 datos, y nunca uses el número desde el que te escribe como si fuera el teléfono de contacto -- solo cuenta si el cliente lo dice explícitamente en el mensaje. Si el mensaje no trae ninguno de los 2 datos (ej. hace una pregunta, pide una aclaración, o dice que no lo tiene a mano), NO llames a la herramienta -- responde en texto, breve, resolviendo eso puntualmente y recordando qué dato sigue faltando. Nunca decidas agendar la cita ni ofrezcas ninguna otra acción -- tu única función en este turno es este dato puntual.

ESTADO ACTUAL DE LA RESERVA (ya confirmado con certeza -- nunca vuelvas a pedir un dato que ya está acá):
${JSON.stringify(reservaEnCurso || {}, null, 2)}`;

  const tools = [{
    name: 'extraer_rut_y_telefono',
    description: 'Registra el RUT y/o el teléfono de contacto que el cliente mencionó explícitamente en su mensaje. Llamar solo con los campos que el cliente realmente haya dicho en ESTE mensaje.',
    input_schema: {
      type: 'object',
      properties: {
        rut: { type: 'string', description: "RUT tal como lo escribió el cliente (ej. '12345678-9'). Omitir si no lo mencionó en este mensaje." },
        telefono: { type: 'string', description: 'Teléfono de contacto tal como lo escribió el cliente. Omitir si no lo mencionó en este mensaje.' },
      },
    },
  }];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemPrompt,
    tools,
    messages: [{ role: 'user', content: mensajeEntrante || '' }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'extraer_rut_y_telefono');

  if (!toolUse) {
    const textBlock = response.content.find((b) => b.type === 'text');
    const texto = textBlock ? textBlock.text : '';
    if (!texto) {
      console.error(
        '[claude.js] extraerRutYTelefono sin texto ni tool_use -- stop_reason:', response.stop_reason,
        '| usage:', JSON.stringify(response.usage)
      );
    }
    return { rut: null, rutInvalido: null, telefono: null, texto: texto ? corregirVoseo(texto) : null };
  }

  // rutInvalido distingue "no lo mencionó" (null) de "lo mencionó pero no
  // es un RUT chileno válido" -- para poder darle feedback específico al
  // cliente (ej. "12.345 no parece un RUT válido") en vez del genérico
  // "pídelo de nuevo", mismo cuidado que ya tenía el bloque original de
  // agendar_cita en claude.js antes de este refactor.
  const rutMencionado = toolUse.input.rut || null;
  const rutValidado = rutMencionado ? normalizarYValidarRut(rutMencionado) : null;
  return {
    rut: rutValidado,
    rutInvalido: rutMencionado && !rutValidado ? rutMencionado : null,
    telefono: toolUse.input.telefono || null,
    texto: null,
  };
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
 * @param {Object|null} [params.reservaEnCurso] - Conversacion.reservaEnCurso, si existe -- usado SOLO para el fallback determinístico si el ciclo de reintentos se agota (paso 10 del fix estructural), nunca para decidir el flujo normal.
 * @returns {Promise<{texto: string, interactivo: Object|null}>}
 */
async function generarRespuestaChatbotSinCorregirVoseo({ empresa, cliente, historial, mensajeEntrante, reservaEnCurso, canal }) {
  // Modo informativo (empresas que no agendan, ej. Multidigital): camino corto y
  // aparte, sin nada de la lógica de citas de más abajo. Ver generarRespuestaInformativa.
  if (empresa.modoInformativo) {
    return generarRespuestaInformativa({ empresa, historial, mensajeEntrante, pais: paisDesdeTelefono(cliente?.telefono, canal) });
  }

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
  const tieneServiciosReales = serviciosReales.length > 0;
  // Bug real reportado en vivo (Ahorróptica, 2026-09-17): con un solo
  // servicio real, el modelo igual llamaba a mostrar_lista_servicios en
  // medio del flujo -- incluso DESPUÉS de que el cliente ya había elegido
  // día y hora, descartando todo el progreso y volviendo a preguntar algo
  // que no tiene ninguna ambigüedad real (solo hay 1 opción posible).
  // Causa probable: el campo "servicio" de las demás herramientas exige
  // el nombre EXACTO de SERVICIOS AGENDABLES, y si el cliente nunca
  // escribió ese nombre literal (ej. dijo "Examen visual" en vez de
  // "Evaluación examen visual"), el modelo se pone cauteloso y prefiere
  // reconfirmar por la herramienta antes de comprometerse -- en vez de
  // simplemente asumir la única opción posible. Fix: cuando hay 2+
  // servicios reales SÍ tiene sentido ofrecer el selector interactivo
  // (ahí la ambigüedad es real); con 0 o 1, no se incluye la herramienta
  // en absoluto, y el modelo sigue la rama de instrucciones en texto de
  // abajo, que para el caso de 1 servicio le dice explícitamente que no
  // pregunte cuál es.
  const hayAmbiguedadDeServicio = serviciosReales.length > 1;

  // Por ahora asumimos un solo RecursoAgendable por empresa (el primero activo).
  // Cuando una empresa tenga varios profesionales, esto deberá preguntarle al
  // cliente cuál prefiere antes de consultar disponibilidad.
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });

  // Catálogo visual: solo se ofrece si el switch maestro está prendido Y hay
  // categorías con al menos un item activo — nunca se le asume al modelo,
  // se le pasa la lista real de nombres como contexto disponible.
  const categoriasCatalogo = empresa.catalogoVisualActivo
    ? await prisma.catalogoCategoria.findMany({
        where: { empresaId: empresa.id, items: { some: { activo: true } } },
        orderBy: { orden: 'asc' },
      })
    : [];
  const incluirCatalogo = categoriasCatalogo.length > 0;

  const tools = construirTools(empresa, hayAmbiguedadDeServicio, incluirCatalogo);

  const bloquesPersonalizacion = [];
  if (empresa.direccion) {
    bloquesPersonalizacion.push(`Dirección del negocio: ${empresa.direccion}`);
  }
  
if (empresa.sitioWeb) {
  bloquesPersonalizacion.push(`Sitio web del negocio: ${empresa.sitioWeb}`);
}

  if (empresa.notaAgendamiento) {
    bloquesPersonalizacion.push(`Nota sobre agendamiento (tono/política a transmitir cuando corresponda): ${empresa.notaAgendamiento}`);
  }


  if (empresa.informacionAdicional) {
    bloquesPersonalizacion.push(
      `Información adicional que puedes citar interpretando su contenido según el TONO DE COMUNICACIÓN especificado más abajo (precios, promociones, qué incluye cada servicio, etc.) — no agregues ni inventes nada que no esté aquí. IMPORTANTE: esto es solo para responder preguntas puntuales, NUNCA para construir, completar ni ampliar la lista de servicios ofrecidos (ver SERVICIOS AGENDABLES arriba y las instrucciones sobre mostrar_lista_servicios):\n${empresa.informacionAdicional}`
    );
  }

  // 3 casos reales, no 2: 0 servicios reales (lista genérica del rubro),
  // exactamente 1 servicio real (sin ninguna ambigüedad que resolver —
  // nunca preguntar ni mostrar selector), y 2+ servicios reales (ahí sí
  // hay una elección real, se resuelve con la herramienta).
  const instruccionServicioAgendar = hayAmbiguedadDeServicio
    ? `- Si el cliente pregunta, de cualquier forma, qué servicios o atenciones ofrece el negocio — sea informativamente (ej. "servicios", "qué atienden", "qué hacen") o porque quiere agendar y no sabes cuál necesita — tu SIGUIENTE ACCIÓN es obligatoriamente llamar a mostrar_lista_servicios, inmediatamente. NUNCA escribas la lista de servicios en texto plano, y NUNCA la construyas ni la completes usando la "información adicional" — esa lista SOLO puede venir de esta herramienta.`
    : tieneServiciosReales
    ? `- Este negocio tiene UN SOLO servicio real: "${serviciosBase[0]}". No hay ninguna ambigüedad que resolver — NUNCA le preguntes al cliente cuál servicio necesita, NUNCA le ofrezcas elegir entre opciones, y NUNCA vuelvas a mencionar el servicio como si hiciera falta confirmarlo de nuevo en algún punto posterior de la conversación (ej. después de que ya eligió día y hora) — el campo "servicio" de cualquier herramienta que llames siempre es exactamente ese nombre, tal cual está escrito arriba, sin importar con qué palabras lo haya nombrado el cliente (ej. si dice "examen visual" o "una hora para la vista", igual es ese servicio). Si el cliente pregunta informativamente qué servicios ofrecen, respóndele con ese único nombre en texto plano.`
    : `- Si el cliente quiere agendar, necesitas saber el SERVICIO antes de mostrar disponibilidad. Si no lo mencionó, pregúntale ÚNICAMENTE el servicio, en un mensaje breve — NUNCA menciones "día", "fecha" ni "cuándo" en ese mensaje.
- Si el cliente pregunta qué servicios ofrecen (y este negocio todavía no tiene servicios reales cargados), respondes ÚNICAMENTE con los nombres de la lista "SERVICIOS AGENDABLES" de arriba, tal cual están escritos — nunca los desgloses en sub-procedimientos ni los reemplaces por detalles clínicos, y nunca uses la "información adicional" para completar o ampliar esa lista.`;

  // Catálogo visual: bloque de categorías e instrucciones, solo si la
  // empresa tiene el switch prendido y hay categorías con items activos
  // (ver incluirCatalogo más arriba).
  const bloqueCategoriasCatalogo = incluirCatalogo
    ? `\nCATEGORÍAS DE CATÁLOGO VISUAL DISPONIBLES (fotos reales que puedes ofrecer — el campo "categoria" de mostrar_catalogo_visual debe ser exactamente uno de estos nombres):\n${categoriasCatalogo.map((c) => `- ${c.nombre}`).join('\n')}\n`
    : '';
  const instruccionesCatalogo = incluirCatalogo
    ? `- Catálogo visual: si el cliente está en fase de indagación (todavía no llamaste a consultar_disponibilidad ni consultar_proximos_dias_disponibles) y lo que pregunta calza con una categoría del catálogo, puedes ofrecerle proactivamente ver fotos — en TEXTO PLANO, con una pregunta breve, ej. "¿Quieres ver algunos ejemplos de [categoría]?". NUNCA llames a mostrar_catalogo_visual solo para hacer esa oferta.
- Llama a mostrar_catalogo_visual recién cuando el cliente confirme que quiere ver las fotos — sea porque respondió que sí a tu oferta, o porque las pidió directamente él mismo en cualquier momento (incluso con el agendamiento ya iniciado — un pedido explícito de fotos siempre se responde, sin excepción). Esto tiene prioridad sobre la obligación de llamar a una herramienta de agendamiento en ESE turno puntual: responde primero con las fotos, y retoma el flujo de agendamiento en el mensaje siguiente, sin perder el contexto de lo que el cliente ya había confirmado antes de pedir ver fotos.
- Apenas el cliente exprese intención de agendar (ej. "quiero una hora", "tienen disponibilidad el sábado", "quiero agendar X") sin haber pedido fotos, deja de ofrecer el catálogo proactivamente y sigue directo con el flujo de agendamiento de abajo.
- Si tras mostrar el catálogo el cliente pide ver más opciones de esa misma categoría, vuelve a llamar a mostrar_catalogo_visual con la página siguiente (pagina: 2, luego 3, etc.).
`
    : '';

  const systemPrompt = `${construirBloqueIdentidad(empresa)}

SERVICIOS AGENDABLES (la única lista válida para ofrecer o agendar — nunca agregues, separes ni inventes otros, aunque la información adicional mencione procedimientos o exámenes relacionados):
${serviciosBase.length ? serviciosBase.map((s) => `- ${s}`).join('\n') : '(el negocio no ha cargado servicios todavía — dile al cliente que consulte directamente)'}
${bloqueCategoriasCatalogo}${bloquesPersonalizacion.length ? '\n' + bloquesPersonalizacion.join('\n\n') + '\n' : ''}
Instrucciones:
- Sé breve, cordial y directo — estás en un chat de WhatsApp, no escribas párrafos largos.
- El historial de este chat puede incluir mensajes de una conversación anterior, a veces de hace semanas o meses. Si el cliente vuelve a saludar ahora (ej. "hola", "buenas", "buenos días"), trátalo como el INICIO de una interacción nueva: preséntate brevemente y pregúntale en qué lo puedes ayudar hoy — nunca asumas que sigue en medio de un trámite de la vez anterior, ni te saltes ese saludo solo porque ya apareció antes en el historial. Esto no afecta sus datos ya guardados (nombre, RUT si corresponde) — solo cómo lo recibes al volver a escribir.
- Si el cliente usa un término genérico o ambiguo (ej. "atención oftalmológica", "revisión de la vista", "chequeo") preguntando informativamente qué significa o qué incluye ese procedimiento puntual (sin pedir la lista completa de servicios), ayúdalo agregando una explicación MUY breve y en lenguaje simple — basándote en tu conocimiento general del área, no en información específica de este negocio.
- Esa explicación es solo DEFINICIÓN de un procedimiento puntual — nunca le digas al cliente cuál necesita según sus síntomas ni hagas ninguna sugerencia clínica. Que él elija con la información, tú no decides por él.
- El campo "servicio" en consultar_disponibilidad/consultar_proximos_dias_disponibles sigue debiendo ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES, tal cual.
- La "información adicional" (si existe) es solo para responder preguntas puntuales que el cliente haga (precios, qué incluye un servicio, etc.) — nunca la uses para construir o ampliar la lista de servicios ofrecidos.
${instruccionServicioAgendar}
${instruccionesCatalogo}- En cuanto sepas el servicio (aunque sea en el mismo mensaje en que el cliente te lo dice, o porque lo eligió de la lista tocable), tu SIGUIENTE ACCIÓN es obligatoriamente llamar a una herramienta — nunca preguntar en texto si quiere ver los días, nunca ofrecerlo como opción, nunca preguntar "¿qué día te gustaría?". Actúa directo:
  - Si el cliente ya mencionó un día específico en algún momento de la conversación (ej. "el jueves", "mañana", una fecha), usa consultar_disponibilidad con esa fecha, inmediatamente.
  - Si el cliente NO ha mencionado ningún día todavía, usa consultar_proximos_dias_disponibles, inmediatamente, sin preguntar antes si quiere verlos.
  - Si el cliente pregunta puntualmente por un día de la semana o fecha concreta (ej. "¿tienen el domingo?", "¿atienden los lunes?") y ese día NO aparece entre los resultados que te devuelve la herramienta, tu texto de respuesta tiene que decirlo explícitamente antes de mostrar la lista (ej. "No atendemos los domingos, pero sí tenemos disponible:") — nunca te limites a reenviar la lista de días reales sin aclarar que el día puntual que preguntó no está, un cliente que no revise la lista con atención puede pensar que sí lo ofreciste.
- Tienes PROHIBIDO escribir frases como "¿qué día te gustaría?", "¿prefieres que te muestre los días disponibles?" o similares — esa decisión la tomas tú llamando a la herramienta correspondiente, nunca preguntándola en texto.
- NUNCA inventes horas ni días disponibles.
- Si acabas de mostrarle al cliente una lista de servicios u horarios y su siguiente mensaje es texto libre (no tocó ningún botón) y escribe EXACTAMENTE una de esas opciones tal como se la mostraste (ej. mostraste horas "09:15, 09:45..." y responde "09:15"), no necesitas hacer nada especial -- el sistema ya la captura automáticamente antes de que tú entres a responder. Si en cambio confirma de forma indirecta o parafraseada (ej. "esa hora está bien", "el examen visual", "me sirve la primera"), pídele amablemente que te reescriba el valor EXACTO tal como se lo mostraste (ej. "¿me confirmas escribiendo exactamente 09:15?") -- nunca asumas tú mismo cuál era ni sigas la conversación como si ya estuviera confirmado.
- NUNCA tienes la capacidad de agendar una cita -- no existe ninguna herramienta para eso, y nunca la vas a tener en esta conversación. El sistema agenda automáticamente, por su cuenta y de forma determinística, en el momento exacto en que ya tiene con certeza fecha, hora, servicio y nombre completo${empresa.requiereRut ? ' (y RUT y teléfono, que este negocio exige)' : ''} -- tú NUNCA le digas al cliente que su cita "quedó agendada", "está lista", ni redactes ningún resumen de confirmación de una cita: ese mensaje lo redacta el sistema aparte, con datos reales, nunca tú.
- SIEMPRE pide el nombre completo de la persona que se va a atender antes de considerar que ya tienes todos los datos, sin importar el negocio — NUNCA asumas el nombre a partir del perfil de WhatsApp del contacto (quien escribe puede no ser quien se atiende, ej. agendando por un familiar), siempre pregúntalo explícitamente.
${empresa.requiereRut ? '- Este negocio además EXIGE RUT y teléfono de contacto para agendar. Pide estos 2 datos si aún no los tienes en la conversación — NUNCA asumas el teléfono a partir del número desde el que te escribe (puede ser distinto), siempre pregúntalo explícitamente.\n' : ''}- Si necesitas mencionar una fecha, usa la fecha en español tal como ya te la haya escrito el cliente, o la que te devuelvan las herramientas — NUNCA calcules tú mismo a qué día de la semana corresponde una fecha ISO (ej. "2026-09-04"), es un cálculo que puedes hacer mal.
- Si el cliente pregunta algo que no está cubierto en la información de este mensaje (precios, condiciones, detalles clínicos), no inventes: dile que lo puede confirmar directamente con el negocio.
- No des información médica ni de salud como si fueras un profesional — solo agenda.`;

  const messages = [
    ...historial.map((m) => ({
      role: m.rol === 'asistente' ? 'assistant' : 'user',
      content: m.contenido,
    })),
    { role: 'user', content: mensajeEntrante },
  ];

  const contexto = { empresa, cliente, recurso, serviciosReales };

  // Detecta si un texto suena a que una cita quedó agendada — desde el paso
  // 9 del fix estructural (2026-09-17), Claude YA NO TIENE ninguna forma de
  // agendar (agendar_cita se quitó del catálogo de tools) — la creación
  // real solo ocurre por el camino determinístico (chatbotEngine.js). Si el
  // modelo igual redacta una confirmación así, es SIEMPRE una alucinación
  // (nunca hay un tool_use real detrás que verificar, a diferencia de antes)
  // y hay que descartarla sin excepción — ver más abajo. Solo se considera
  // si el turno anterior del bot fue la recapitulación pidiendo confirmación
  // final (ej. "¿Todo correcto?") — así no se dispara ante una pregunta
  // informativa posterior sobre una cita YA agendada de verdad (ej. "¿quedó
  // confirmada mi hora?").
  // Regex deliberadamente amplio: el modelo redacta esta recapitulación
  // con sus propias palabras cada vez (ej. "¿Todo correcto?", "¿Todo está
  // correcto?", "¿Está todo bien así?") — un patrón rígido calzaba con la
  // primera variante y no con la segunda, dejando pasar el bug real en una
  // corrida de prueba real (7/8 detectado, 1/8 se le escapó por esto).
  const ultimoTurnoBot = [...historial].reverse().find((m) => m.rol === 'asistente');
  const veniaDeRecapitulacion = /correcto\s*[?¿✓]|¿confirmas|confirma.{0,20}agend/i.test(ultimoTurnoBot?.contenido || '');
  const pareceConfirmacionDeCita = (texto) =>
    veniaDeRecapitulacion && /tu cita (ha sido|está|quedó)|cita (ha sido |fue )?agendada|resumen de tu cita|¡listo!/i.test(texto || '');

  // Bug real encontrado (Ahorróptica, 2026-09-02): al preguntar por un
  // segundo día en la misma conversación ("Y para el domingo 06"), el
  // modelo respondió con una lista de horarios COMPLETA E INVENTADA,
  // copiando el formato exacto del atajo de horariosParaMostrar ("Estos
  // son los horarios disponibles para el ... Elige el que más te acomode
  // 👇") sin haber llamado a consultar_disponibilidad — confirmado con el
  // motor real: ese día no tenía NINGUNA hora disponible. El patrón de
  // texto es justo ese wording fijo (viene del código, nunca lo redacta el
  // modelo de forma natural) — que aparezca en un turno sin tool_use es
  // señal casi segura de que el modelo lo copió de un turno anterior en
  // vez de consultar de nuevo.
  // Ampliado 2026-09-03: el wording fijo de arriba dejó pasar una variante
  // real — el modelo narró "Los horarios disponibles para HOY son: 14:00,
  // 14:15, ...  ¿Cuál te viene bien?" (sin "para el [día]" ni "elige el que
  // más te acomode") para un jueves sin NINGÚN horario configurado
  // (confirmado con el motor real: obtenerHorariosDisponibles devuelve []).
  // El wording exacto varía cada vez que el modelo lo redacta libremente,
  // así que además del patrón fijo, se detecta cualquier turno sin
  // tool_use que liste 3+ horas en formato HH:MM sueltas en el texto — el
  // atajo real SÍ pone las horas en el cuerpo del mensaje, pero eso solo
  // pasa cuando la herramienta se llamó de verdad (este chequeo corre solo
  // en el turno SIN tool_use, así que nunca choca con el atajo real).
  // Falso positivo real encontrado (Ahorróptica, 2026-09-07, cliente
  // preguntando "¿reparan lentes?"): el modelo respondió citando el
  // HORARIO DE ATENCIÓN del local ("Lunes a viernes: 09:30 a 19:00 hrs,
  // Sábado: 10:00 a 14:00 hrs") como parte de una respuesta válida — las 4
  // horas de esos 2 rangos activaban este heurístico igual que si fueran
  // horas de cita inventadas, forzando reintentos hasta agotar las 5
  // rondas y caer en el mensaje de error genérico. Los rangos de horario
  // ("HH:MM a/hasta/- HH:MM") se descartan antes de contar — el bug real
  // que este heurístico atrapa siempre listó horas SUELTAS (ej. "14:00,
  // 14:15, 14:30"), nunca rangos de apertura/cierre.
  const pareceListaDeHorariosInventada = (texto) => {
    const t = texto || '';
    if (/horarios? disponibles para el/i.test(t) && /elige el que más te acomode/i.test(t)) return true;
    const sinRangosDeHorarioAtencion = t.replace(
      /\b([01]?\d|2[0-3]):[0-5]\d\s*(a|hasta|-|–)\s*([01]?\d|2[0-3]):[0-5]\d\b/gi,
      ''
    );
    const horasEnTexto = sinRangosDeHorarioAtencion.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || [];
    return horasEnTexto.length >= 3;
  };

  // Misma clase de bug, pero para la lista de PRÓXIMOS DÍAS (cuando el
  // cliente no especifica fecha) — confirmado en vivo (Ahorróptica,
  // 2026-09-02): el bot mostró "Los próximos días con disponibilidad para
  // 'Evaluación examen visual' son: 4 (viernes), 5 (sábado), 6 (domingo)"
  // con formato propio (no el wording fijo de armarTextoProximosDias) —
  // ninguno de esos 3 días tenía disponibilidad real, y los días
  // realmente disponibles (11, 12, 25, 26) no se mencionaron. El modelo
  // fabricó la lista completa sin llamar a
  // consultar_proximos_dias_disponibles. Detecta la mención genérica a
  // "próximos días" o un patrón de 2+ fechas con día de semana entre
  // paréntesis (ej. "4 de septiembre (viernes)") — el wording exacto varía
  // cada vez que el modelo lo redacta libremente.
  const pareceListaDeDiasInventada = (texto) => {
    const t = texto || '';
    if (/pr[oó]ximos d[ií]as/i.test(t)) return true;
    const fechasConDia = t.match(/\d{1,2}\s+de\s+\p{L}+.{0,3}\((domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\)/giu) || [];
    return fechasConDia.length >= 2;
  };

  // Bug real encontrado (Ahorróptica, 2026-09-02): el cliente pide hablar
  // con un ejecutivo, el modelo responde en texto plano "Dale, te paso con
  // un ejecutivo..." SIN llamar a escalar_a_humano — la conversación nunca
  // queda pausada de verdad, y menos de un minuto después el bot vuelve a
  // saludar como si nada. Mismo mecanismo que los dos anteriores: si el
  // texto suena a esa promesa sin la herramienta real, se descarta y se
  // reintenta forzando la llamada.
  const pareceOfertaDeHumanoInventada = (texto) =>
    /te (paso|comunico|conecto|derivo)\s+(con|a)\s+(un|una|el|la)?\s*(ejecutivo|persona|agente|humano)/i.test(texto || '');

  // Bug real reportado por Ahorróptica (2026-09-09): el cliente escribe
  // "quiero agendar una hora" sin decir el servicio, y el bot a veces
  // responde con un menú de texto libre propio ("1️⃣ Agendar hora / 2️⃣
  // Cotizar... / 3️⃣ Chatear con un ejecutivo") en vez de llamar a
  // mostrar_lista_servicios como exige la instrucción de arriba — el
  // cliente tiene que volver a escribir el servicio para que el bot recién
  // ahí avance. Reproducido en vivo (scripts/_probar-fechas-no-automaticas-ahoroptica.js).
  // Mismo mecanismo que los otros bugs de esta familia: si el texto tiene
  // pinta de menú numerado (2+ opciones con marcador tipo "1️⃣"/"1)"/"1.")
  // y el negocio sí tiene la herramienta real disponible, se descarta y se
  // reintenta forzando la llamada.
  // Ampliado 2026-09-16 (reporte real de Ahorróptica): el modelo redactó el
  // mismo tipo de menú inventado en el saludo inicial ("Hola") pero con
  // viñetas ("· Agendar una evaluación visual") en vez de marcadores
  // numerados -- la regex original solo buscaba "1️⃣"/"1)"/"1.", así que
  // esta variante se coló sin ser detectada.
  const pareceMenuDeOpcionesSinHerramienta = (texto) => {
    // Si no hay ambigüedad real de servicio (0 o 1 servicio real),
    // mostrar_lista_servicios ni siquiera está en `tools` -- forzarla
    // igual rompería la llamada a la API (tool_choice apuntando a una
    // herramienta que no existe en este turno).
    if (!hayAmbiguedadDeServicio) return false;
    const marcadores = (texto || '').match(/(?:^|\n)\s*(?:[1-9]️⃣|[1-9][.)]|[·•])\s*\S/gm) || [];
    return marcadores.length >= 2;
  };

  // Bucle de tool use: Claude puede pedir usar una herramienta varias veces
  // seguidas (ej. consultar disponibilidad, o un reintento forzado por una
  // de las heurísticas de arriba) antes de dar la respuesta final en
  // texto. Reducido de 5 a 2 intentos (paso 10 del fix estructural,
  // 2026-09-17): con el camino determinístico (taps, fast-path de texto,
  // extracción de RUT) cubriendo la mayoría de las transiciones ciertas,
  // el pipeline completo ya solo se usa para las partes genuinamente
  // conversacionales -- 5 reintentos eran un resabio de cuando este ciclo
  // tenía que cargar con todo el flujo. Si se agotan los 2 intentos, cae a
  // PLANTILLAS_DETERMINISTAS (más abajo) en vez de un mensaje genérico de
  // error.
  let forzarHerramienta = null; // null | 'consultar_disponibilidad' | 'consultar_proximos_dias_disponibles' | 'escalar_a_humano' | 'mostrar_lista_servicios'
  for (let intentos = 0; intentos < 2; intentos++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      // 500 alcanzaba de sobra con Haiku (no piensa). Con Sonnet 5, que
      // corre "thinking" adaptativo por defecto sin necesidad de pedirlo
      // (a diferencia de modelos anteriores), los tokens de thinking
      // también cuentan contra max_tokens -- un system prompt tan largo
      // como el de acá (cientos de líneas de instrucciones + tools reales)
      // puede hacer pensar bastante más que el caso simple de prueba
      // (25 tokens de thinking). Encontrado real (2026-09-16): con 500,
      // algunos turnos cortaban a mitad de camino y volvían sin texto,
      // cayendo en el mensaje genérico de abajo. Con 1500 volvió a pasar en el
      // modo informativo (ver MAX_TOKENS_RESPUESTA).
      max_tokens: MAX_TOKENS_RESPUESTA,
      system: sistemaConCache(systemPrompt),
      tools,
      ...(forzarHerramienta ? { tool_choice: { type: 'tool', name: forzarHerramienta } } : {}),
      messages: mensajesConCache(messages),
    });
    registrarUsoCache('agenda', response);
    forzarHerramienta = null;

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const texto = textBlock ? textBlock.text : '';

      // Visibilidad permanente para el caso de arriba: si de verdad no
      // hubo texto (ni tool_use), esto es siempre una señal de que algo
      // salió mal -- nunca debería pasar en un turno normal. Se loguea
      // para poder diagnosticar sin tener que reproducirlo a mano de
      // nuevo si vuelve a ocurrir.
      if (!texto) {
        console.error(
          '[claude.js] Turno sin texto ni tool_use -- stop_reason:', response.stop_reason,
          '| bloques:', response.content.map((b) => b.type).join(','),
          '| usage:', JSON.stringify(response.usage)
        );
      }

      // Bug real encontrado originalmente con agendar_cita como tool
      // (Ahorróptica, cliente "yaye", 2026-09-01): en el turno de
      // confirmación final, el modelo a veces responde con texto plano
      // narrando "¡Listo! Tu cita ha sido agendada..." sin que exista
      // ninguna cita real. Desde el paso 9, Claude no tiene NINGUNA forma
      // de agendar -- así que esto ya no se puede "arreglar" reintentando
      // una tool (no hay ninguna que forzar). Se descarta directo y se le
      // pide al cliente que confirme por la vía determinística (tocar la
      // opción, o escribirla tal cual se le mostró) -- nunca se deja pasar
      // un texto que promete algo que no ocurrió.
      if (pareceConfirmacionDeCita(texto)) {
        console.warn('[claude.js] Turno pareció confirmar una cita sin ningún camino real para agendarla -- descartado.');
        return {
          texto: 'Antes de dejar tu cita lista, confírmamela tocando la opción de la lista que te mostré, o escribiéndomela tal cual apareció ahí 🙌',
          interactivo: null,
        };
      }

      // Mismo mecanismo para el bug de horarios inventados (ver comentario
      // de pareceListaDeHorariosInventada más arriba).
      if (pareceListaDeHorariosInventada(texto)) {
        forzarHerramienta = 'consultar_disponibilidad';
        continue;
      }

      // Mismo mecanismo para la lista de PRÓXIMOS DÍAS inventada (ver
      // comentario de pareceListaDeDiasInventada más arriba).
      if (pareceListaDeDiasInventada(texto)) {
        forzarHerramienta = 'consultar_proximos_dias_disponibles';
        continue;
      }

      // Mismo mecanismo para la promesa de "te paso con un ejecutivo" sin
      // pausar de verdad (ver pareceOfertaDeHumanoInventada más arriba).
      if (pareceOfertaDeHumanoInventada(texto)) {
        forzarHerramienta = 'escalar_a_humano';
        continue;
      }

      // Mismo mecanismo para el menú de opciones inventado sin llamar a
      // mostrar_lista_servicios (ver pareceMenuDeOpcionesSinHerramienta más arriba).
      if (pareceMenuDeOpcionesSinHerramienta(texto)) {
        forzarHerramienta = 'mostrar_lista_servicios';
        continue;
      }

      return { texto: texto || 'Disculpa, ¿puedes repetir tu mensaje?', interactivo: null };
    }

    // Guardamos el turno del asistente (incluye los tool_use blocks) y
    // ejecutamos cada herramienta pedida, devolviendo el resultado.
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    let horariosParaMostrar = null;
    let diasParaMostrar = null;
    let serviciosParaMostrar = null;
    let catalogoParaMostrar = null;
    let servicioResueltoParaMostrar = null;
    let seEscaloAHumano = false;

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
          horariosParaMostrar = { fecha: resultado.fecha, horas: resultado.horasDisponibles, bloques: resultado.bloques || [] };
          servicioResueltoParaMostrar = { servicioId: resultado.servicioId, servicioNombre: resultado.servicioNombre };
        }

        // Mismo mecanismo, pero para la lista de PRÓXIMOS DÍAS (cuando el
        // cliente no especificó fecha).
        if (block.name === 'consultar_proximos_dias_disponibles' && resultado.dias?.length > 0) {
          diasParaMostrar = resultado.dias;
          servicioResueltoParaMostrar = { servicioId: resultado.servicioId, servicioNombre: resultado.servicioNombre };
        }

        // Mismo mecanismo, pero para la lista de SERVICIOS reales.
        if (block.name === 'mostrar_lista_servicios' && resultado.servicios?.length > 0) {
          serviciosParaMostrar = resultado.servicios;
        }

        // Mismo mecanismo, pero para las imágenes del catálogo visual. Si la
        // categoría no existe o no tiene items en esta página (arreglo
        // vacío), dejamos que el ciclo siga normal para que Claude responda
        // en texto (ej. "no encontré esa categoría").
        if (block.name === 'mostrar_catalogo_visual' && resultado.items?.length > 0) {
          catalogoParaMostrar = resultado;
        }

        // El cliente pidió hablar con una persona real — se corta el ciclo
        // con un texto fijo (nunca dejar que el modelo redacte "te paso
        // con alguien" libremente, ver pareceOfertaDeHumanoInventada) y se
        // señala escaladoAHumano:true en el resultado para que
        // chatbotEngine.js pause la conversación de verdad.
        if (block.name === 'escalar_a_humano') {
          seEscaloAHumano = true;
        }
      }
    }

    if (seEscaloAHumano) {
      return {
        texto: '¡Dale! En un momento te contactamos directamente 🙌',
        interactivo: null,
        escaladoAHumano: true,
      };
    }

    if (serviciosParaMostrar) {
      // Bug real reportado por Ahorróptica (2026-09-15): el cliente ya
      // había escrito el nombre EXACTO de un servicio real en ESTE mismo
      // mensaje (ver mensajeNombraServicioExactoSinDia arriba), pero Claude
      // de todas formas llamó a mostrar_lista_servicios de nuevo en vez de
      // avanzar. En este caso no tiene sentido repetir la pregunta — ya
      // sabemos el servicio — así que forzamos el siguiente paso real
      // (consultar_proximos_dias_disponibles, ya que este mensaje no
      // mencionó ningún día) en vez de devolver la lista otra vez.
      const servicioYaNombrado = mensajeNombraServicioExactoSinDia(mensajeEntrante, serviciosReales);
      if (servicioYaNombrado) {
        forzarHerramienta = 'consultar_proximos_dias_disponibles';
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Bug real reportado por Ahorróptica (2026-09-14, clienta "Rosa
      // Levi"): el cliente no elige ningún servicio de la lista mostrada
      // (ej. responde con su nombre en vez de tocar una opción), y el bot
      // vuelve a preguntar con el EXACTO mismo texto — se ve como que "no
      // entrega alternativas" cuando en realidad sí las mandó la primera
      // vez, solo que el cliente no las usó. Si el turno anterior del bot
      // ya fue esta misma pregunta (cualquiera de sus 2 variantes), la
      // segunda vez usamos un texto que reconoce su mensaje y lo dirige
      // explícitamente al menú, en vez de repetir la pregunta tal cual,
      // para que quede claro que falta elegir del menú. Ya NO se
      // personaliza con el nombre (ver comentario de
      // TEXTO_PREGUNTA_SERVICIOS_REPETIDA más arriba).
      const yaHabiaPreguntado = ultimoTurnoBot?.contenido === TEXTO_PREGUNTA_SERVICIOS || esPreguntaDeServiciosRepetida(ultimoTurnoBot?.contenido);
      let texto = TEXTO_PREGUNTA_SERVICIOS;
      if (yaHabiaPreguntado) {
        texto = TEXTO_PREGUNTA_SERVICIOS_REPETIDA;
      }
      return {
        texto,
        interactivo: { tipo: 'lista_servicios', servicios: serviciosParaMostrar },
      };
    }

    // servicioId/servicioNombre se agregan directo al interactivo (no
    // afecta a WhatsApp al enviar -- enviarRespuestaAgendamiento en
    // server.js solo lee los campos que ya conocía) para que
    // conOpcionesDelPipelineAgentico (chatbotEngine.js) pueda sembrar
    // reservaEnCurso.servicioId con la misma certeza que si el cliente
    // hubiera tocado el servicio -- ver comentario en
    // ejecutarHerramienta#consultar_disponibilidad.
    if (horariosParaMostrar) {
      const armada = armarRespuestaHorarios(horariosParaMostrar.fecha, horariosParaMostrar.horas, horariosParaMostrar.bloques);
      return { texto: armada.texto, interactivo: { ...armada.interactivo, ...servicioResueltoParaMostrar } };
    }

    if (diasParaMostrar) {
      const armada = armarRespuestaProximosDias(diasParaMostrar, mensajeEntrante);
      return { texto: armada.texto, interactivo: { ...armada.interactivo, ...servicioResueltoParaMostrar } };
    }

    if (catalogoParaMostrar) {
      const hayMas = catalogoParaMostrar.totalActivos > catalogoParaMostrar.mostrados;
      return {
        texto: `Aquí tienes algunos ejemplos de ${catalogoParaMostrar.categoria} 👇${hayMas ? ' ¿Quieres ver más opciones?' : ''}`,
        interactivo: { tipo: 'catalogo_imagenes', items: catalogoParaMostrar.items },
      };
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Se agotaron los intentos sin una respuesta utilizable -- en vez de un
  // mensaje genérico de error (que no ayuda al cliente a avanzar), se cae
  // a la plantilla fija del paso que le corresponde según reservaEnCurso
  // (la misma red de seguridad que ya usa el camino determinístico, ver
  // flujoReserva.js#PLANTILLAS_DETERMINISTAS). Si no hay reservaEnCurso
  // todavía (conversación recién empezada), el paso siempre resuelve a
  // PEDIR_SERVICIO o PEDIR_DIA según corresponda, nunca a un mensaje vacío.
  console.warn(
    '[claude.js] Se agotaron los intentos del pipeline agéntico sin respuesta utilizable -- usando fallback determinístico.',
    '| empresa:', empresa.id
  );
  const pasoFallback = siguientePaso(reservaEnCurso, { hayAmbiguedadDeServicio, requiereRut: !!empresa.requiereRut });
  return { texto: PLANTILLAS_DETERMINISTAS[pasoFallback], interactivo: null };
}

/**
 * Modo informativo (Empresa.modoInformativo): el negocio no agenda por el chat, solo
 * informa y deriva a una persona. A diferencia del camino de agendamiento, acá el modelo
 * SÍ puede listar los productos/servicios que figuren en informacionAdicional (esa es
 * la fuente del catálogo), y solo tiene una herramienta: escalar_a_humano. No hay
 * herramientas de disponibilidad ni lista de servicios, así que no puede iniciar nada
 * de agendar. Se llama desde generarRespuestaChatbotSinCorregirVoseo (el voseo se
 * corrige igual en generarRespuestaChatbot).
 */
// "Buenos días/tardes/noches" según la hora de Chile -- lo calcula el código, no el
// modelo (que no sabe la hora). Se usa en el guion de atención del modo informativo.
function saludoSegunHoraChile(ahora = new Date(), zonaHoraria = 'America/Santiago') {
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, hour: 'numeric', hourCycle: 'h23' }).format(ahora));
  if (hora >= 5 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

// País de quien escribe, por el código de su WhatsApp, para los anuncios de Multidigital
// en Perú y Colombia (2026-10-24). Solo celulares con el largo exacto (Perú 51 + 9 + 8
// dígitos, Colombia 57 + 3 + 9 dígitos): un IGSID de Instagram también son puros dígitos
// y no debe confundirse con un teléfono. null = Chile u otro (el guion de siempre).
// Precios de Multidigital por país, definidos por Rubén (los mismos del afiche de cada
// país; hoy solo Multidigital tiene guion). Sin impuesto agregado: la venta al extranjero
// se trata aparte en contabilidad. Agregar un país = una fila acá (celular: patrón sobre
// los dígitos de su WhatsApp, con el largo exacto para no confundirlo con un IGSID).
//   PE, CO: 2026-10-24. MX: 2026-10-25 (México en WhatsApp llega como 52 + 10 dígitos,
//   o 521 + 10 en números antiguos; "a los 12 meses el sitio es tuyo" es solo de México).
const PAISES_GUION = {
  PE: { nombre: 'Perú', zonaHoraria: 'America/Lima', celular: /^519\d{8}$/, mensual: 'S/ 39 al mes', hosting: 'S/ 149 al año', dominio: '.pe' },
  CO: { nombre: 'Colombia', zonaHoraria: 'America/Bogota', celular: /^573\d{9}$/, mensual: '$39.900 COP al mes', hosting: '$149.000 COP al año', dominio: '.co' },
  MX: {
    nombre: 'México', zonaHoraria: 'America/Mexico_City', celular: /^521?\d{10}$/,
    mensual: '$299 MXN al mes', hosting: '$749 MXN al año', dominio: '.mx o .com.mx',
    extra: 'Incluye certificado SSL. A los 12 meses de servicio, el sitio pasa a ser del cliente.',
  },
};
function paisDesdeTelefono(telefono, canal = 'whatsapp') {
  if (canal !== 'whatsapp' || !telefono) return null;
  // Quien oculta su número con nombre de usuario llega con un id de WhatsApp que parte
  // con el país, ej. "CO.2549034048909580" (ver esIdUsuarioWhatsApp en whatsapp.js).
  const paisId = /^([A-Z]{2})\.[A-Za-z0-9.]+$/.exec(String(telefono));
  if (paisId) return PAISES_GUION[paisId[1]] ? paisId[1] : null;
  const d = String(telefono).replace(/\D/g, '');
  return Object.keys(PAISES_GUION).find((pais) => PAISES_GUION[pais].celular.test(d)) || null;
}

// Con guion y una persona de otro país: los precios del guion son de Chile (pesos
// chilenos, IVA, UF, promo con fecha) y se reemplazan por los de su país; el resto del
// guion (apertura, datos, cierre) sigue igual.
function preciosPais(pais) {
  const { nombre, mensual, hosting, dominio, extra } = PAISES_GUION[pais];
  return `Precios para ${nombre}: el sitio web de una página + 2 correos corporativos cuesta ${mensual}, sin permanencia. El hosting cuesta ${hosting}. El dominio ${dominio} lo paga el cliente directamente al inscribirlo; nosotros lo asesoramos sin costo.${extra ? ` ${extra}` : ''} Todo lo que vaya más allá del ejemplo que le enviamos se cotiza aparte.`;
}
// "¿Cuánto cuesta?", "¿qué precio tiene?", "¿y el hosting?"... Si además pide una persona
// o una llamada, no cuenta: ahí sí se deriva como siempre.
function pareceConsultaDePrecio(texto) {
  const t = texto || '';
  return /cu[aá]nto\s+(cuesta|sale|vale|cobran|es|ser[ií]a)|precio|valor|costo|tarifa|hosting|dominio/i.test(t)
    && !/persona|humano|alguien|ejecutivo|ll[aá]m/i.test(t);
}
function instruccionesPaisExtranjero(pais) {
  const { nombre } = PAISES_GUION[pais];
  return `

PERSONA DE ${nombre.toUpperCase()} (su WhatsApp es de ${nombre}; esto tiene prioridad sobre el guion en lo que se contradiga):
- Atiéndela igual que el guion (misma apertura, mismos datos, mismo cierre), pero pide "ciudad" en vez de "comuna".
- ${preciosPais(pais)} Son los ÚNICOS precios que puedes dar y SÍ los tienes: si pregunta el precio, el hosting o el dominio, respóndele con ellos tal cual (nunca "desde"), sin agregar impuestos y sin derivar, y retoma el guion.
- NO menciones pesos chilenos, ni IVA, ni UF, ni pago anual, ni la promoción del hosting. Los correos y el sitio van con su propio dominio (${PAISES_GUION[pais].dominio} u otro), nunca digas ".cl".
- Si pregunta si atienden en ${nombre}: sí, el servicio es 100% online.
- No uses modismos chilenos.`;
}

// Precios de Chile ($ en pesos, IVA, UF). Para Perú y Colombia se sacan del texto que ve
// el modelo: con solo pedirle "no los menciones" los repetía igual (prueba en staging,
// 2026-10-24), porque el guion y la información los traen explícitos.
const TIENE_PRECIO_CHILENO = /\$\s?\d|\bIVA\b|\bUF\b/;

// Guion sin las líneas que traen precios (ej. "4. Si pregunta el precio: ...$9.900 + IVA...").
function guionSinPrecios(guion) {
  return guion.split('\n').filter((linea) => !TIENE_PRECIO_CHILENO.test(linea)).join('\n');
}

// Información del negocio sin las frases que traen precios (se corta por ". ", así un
// número como "9.900" no parte la frase).
function informacionSinPrecios(info) {
  return info.split('\n')
    .map((linea) => linea.split(/(?<=\.)\s+/).filter((frase) => !TIENE_PRECIO_CHILENO.test(frase)).join(' '))
    .join('\n');
}

// Instrucciones del modo informativo. Con guionAtencion, el guion manda: no se parte
// mostrando el catálogo y se piden los datos que el guion indique antes de derivar.
function instruccionesModoInformativo(empresa, ahora, pais = null) {
  const comunes = [
    '- Sé breve, cordial y directo: estás en un chat de WhatsApp, no escribas párrafos largos.',
    '- Si pregunta por un producto en particular, respóndele solo con lo que dice la información.',
    '- Si pregunta algo que NO está en la información (precios de otros productos, plazos, condiciones, detalles), no lo inventes: llama a escalar_a_humano. Esa herramienta avisa al equipo y pausa el chat para que una persona le responda; nunca prometas "una persona te contactará" sin llamarla.',
    '- Si dice que no le interesa, agradécele y no insistas.',
    '- No des información médica ni de salud como si fueras un profesional.',
  ];
  if (!empresa.guionAtencion) {
    // Mismo texto y orden que antes del guion (2026-10-23): sin guion no cambia nada.
    const [breve, producto, noInventes, noInteresa, medica] = comunes;
    return [
      breve,
      '- Si el cliente saluda, preséntate brevemente y pregúntale en qué lo puedes ayudar.',
      '- Si pregunta qué servicios, productos o soluciones ofrece el negocio, enumera TODOS los que figuren en la información, en una lista corta con guiones, y pregunta cuál le interesa. Nunca agregues ni inventes otros.',
      producto,
      noInventes,
      '- Si el cliente quiere contratar, cotizar, agendar una reunión o hablar con alguien, o pide una persona, usa escalar_a_humano.',
      '- NUNCA ofrezcas agendar, ni pidas día, hora, RUT ni nombre completo, ni muestres horarios.',
      noInteresa,
      medica,
    ].join('\n');
  }
  return `GUION DE ATENCIÓN (tiene prioridad sobre todo lo demás; síguelo con cada persona que escriba, venga o no de un anuncio):
${empresa.guionAtencion}

Saludo que corresponde a la hora actual ${pais ? `en ${PAISES_GUION[pais].nombre}` : 'en Chile'}: "${saludoSegunHoraChile(ahora, pais ? PAISES_GUION[pais].zonaHoraria : undefined)}". Úsalo tal cual en tu primer mensaje de la conversación (no lo repitas después).
Fecha de hoy en Chile: ${new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora)}. Si una promoción del guion o de la información tiene una fecha de término que ya pasó, NO la menciones ni la ofrezcas.

Instrucciones:
- Si es el inicio de la conversación (aunque la persona solo salude o escriba un mensaje automático del anuncio), responde con la apertura del guion (si el guion distingue un saludo suelto de una consulta, sigue esa distinción). NO muestres el catálogo completo de entrada.
- Pide los datos del guion de a uno o dos por mensaje, nunca todos juntos como formulario. No vuelvas a pedir un dato que la persona ya dio.
- Si en medio del guion hace una pregunta, respóndela corto con la información y retoma el guion.
- Solo si pregunta explícitamente qué otros productos o servicios ofrecen, enuméralos de la información en una lista corta.
- Cuando ya tengas todos los datos que pide el guion, escribe el mensaje de cierre del guion usando su nombre Y llama a escalar_a_humano en esa misma respuesta.
- Si la persona quiere contratar o cotizar, primero completa los datos del guion; solo si pide explícitamente hablar con una persona, llama a escalar_a_humano de inmediato.
${comunes.join('\n')}
- NUNCA ofrezcas agendar, ni pidas día, RUT ni muestres horarios (sí puedes preguntar en qué horario le acomoda que lo llamen, si eligió la llamada).${pais ? instruccionesPaisExtranjero(pais) : ''}`;
}

/**
 * Extrae los datos de un interesado de la conversación del guion de atención (panel
 * Clientes Web, ver src/lib/leadClienteWeb.js). Usa una herramienta con esquema para
 * que la respuesta sea JSON confiable. Devuelve {} si no hay nada que extraer.
 * Solo extrae lo que la persona dijo: nunca inventa.
 */
async function extraerDatosLeadWeb(mensajes) {
  const transcripcion = mensajes
    .map((m) => `${m.rol === 'asistente' ? 'Bot' : 'Cliente'}: ${m.contenido}`)
    .join('\n')
    .slice(-6000);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: 'Extraes datos de contacto de una conversación de WhatsApp entre un bot y una persona interesada en un sitio web. Usa SOLO lo que la persona escribió; si un dato no aparece, déjalo vacío. Nunca inventes.',
    tools: [{
      name: 'guardar_lead',
      description: 'Guarda los datos del interesado.',
      input_schema: {
        type: 'object',
        properties: {
          negocio: { type: 'string', description: 'Nombre del negocio, tal como lo dijo' },
          rubro: { type: 'string', description: 'De qué se trata el negocio (ej. peluquería, taller mecánico)' },
          contactoNombre: { type: 'string', description: 'Nombre de la persona' },
          comuna: { type: 'string', description: 'Comuna o ciudad' },
          preferencia: { type: 'string', enum: ['EJEMPLO', 'LLAMADA', ''], description: 'Qué eligió: el ejemplo gratis o una llamada' },
          horarioLlamada: { type: 'string', description: 'Horario en que pidió que lo llamen, si eligió llamada' },
        },
      },
    }],
    tool_choice: { type: 'tool', name: 'guardar_lead' },
    messages: [{ role: 'user', content: `Conversación:\n${transcripcion}` }],
  });
  const uso = response.content.find((b) => b.type === 'tool_use');
  return uso ? uso.input : {};
}

// Segundo paso del ciclo de herramientas: con escalar_a_humano ya llamado (y el chat por
// pausarse), se le pide al modelo SOLO el mensaje de cierre del guion. Sin herramientas
// disponibles para esta respuesta (tool_choice none). Si falla, devuelve '' y se usa el
// cierre por defecto: el lead igual queda derivado.
async function pedirCierreDelGuion(systemPrompt, herramientas, messages, contenidoAsistente, toolUseId) {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_RESPUESTA,
      system: sistemaConCache(systemPrompt),
      tools: herramientas,
      tool_choice: { type: 'none' },
      messages: mensajesConCache([
        ...messages,
        { role: 'assistant', content: contenidoAsistente },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: 'Equipo avisado; el chat queda en manos de una persona. Escribe ahora SOLO el mensaje de cierre del guion para la persona (el que corresponda a lo que eligió, con su nombre si lo sabes).',
          }],
        },
      ]),
    });
    registrarUsoCache('cierre', response);
    const bloque = response.content.find((b) => b.type === 'text');
    return bloque ? bloque.text.trim() : '';
  } catch (error) {
    console.error('[claude.js] No se pudo obtener el cierre del guion:', error.message);
    return '';
  }
}

// Con guion, el saludo ("¡Buenas noches! 👋 Te saluda el equipo de X.") va solo en el
// primer mensaje del bot. Si la persona saluda y después pregunta, el modelo igual lo
// repetía al dar la apertura completa (prueba en staging, 2026-10-24), aunque el guion
// dice que no: se quita del comienzo cuando el bot ya habló en esta conversación.
const SALUDO_INICIAL = /^¡\s*Buen[oa]s\s+(días|tardes|noches)\s*!\s*(👋\s*)?(Te saluda el equipo de [^.!\n]+[.!]\s*)?/i;
// Solo si el bot habló hace poco: alguien que vuelve a escribir días después sí recibe
// el saludo de nuevo (es otra conversación para él).
const HORAS_SIN_REPETIR_SALUDO = 6;
function quitarSaludoRepetido(texto, historial) {
  const ultimoDelBot = [...historial].reverse().find((m) => m.rol === 'asistente');
  if (!texto || !ultimoDelBot) return texto;
  const horasDesde = ultimoDelBot.timestamp ? (Date.now() - new Date(ultimoDelBot.timestamp).getTime()) / 3600000 : 0;
  if (horasDesde > HORAS_SIN_REPETIR_SALUDO) return texto;
  const sinSaludo = texto.replace(SALUDO_INICIAL, '');
  if (!sinSaludo || sinSaludo === texto) return texto;
  return sinSaludo.charAt(0).toUpperCase() + sinSaludo.slice(1);
}

async function generarRespuestaInformativa({ empresa: empresaOriginal, historial, mensajeEntrante, ahora = new Date(), pais: paisTelefono = null }) {
  // Solo con guion se distingue el país (ver paisDesdeTelefono).
  const pais = empresaOriginal.guionAtencion ? paisTelefono : null;
  const empresa = pais
    ? {
      ...empresaOriginal,
      guionAtencion: guionSinPrecios(empresaOriginal.guionAtencion),
      // Los precios del país van DENTRO de la información: el prompt la declara la única
      // fuente válida y manda derivar lo que no esté ahí (sin esto, en la prueba de
      // staging del 2026-10-24 el bot derivaba a Perú en vez de darle S/ 39).
      informacionAdicional: [
        empresaOriginal.informacionAdicional && informacionSinPrecios(empresaOriginal.informacionAdicional),
        preciosPais(pais),
      ].filter(Boolean).join('\n'),
    }
    : empresaOriginal;
  const identidad = construirBloqueIdentidad(empresa).replace(
    'Eres el asistente de agendamiento de',
    'Eres el asistente de atención e información de'
  );
  const bloques = [];
  if (empresa.sitioWeb) bloques.push(`Sitio web del negocio: ${empresa.sitioWeb}`);
  if (empresa.direccion) bloques.push(`Dirección del negocio: ${empresa.direccion}`);
  bloques.push(
    empresa.informacionAdicional
      ? `INFORMACIÓN DEL NEGOCIO (es la ÚNICA fuente válida; puedes citarla y listar de ella todos los productos o servicios, con sus precios solo si están indicados, tal cual aparecen):\n${empresa.informacionAdicional}`
      : '(El negocio no cargó información todavía: no inventes nada, ofrece derivar con una persona.)'
  );

  const systemPrompt = `${identidad}

Este negocio NO agenda citas ni reuniones por este chat: tu trabajo es informar y derivar a una persona del equipo.

${bloques.join('\n\n')}

${empresa.guionAtencion ? '' : 'Instrucciones:\n'}${instruccionesModoInformativo(empresa, ahora, pais)}`;

  const herramientas = construirTools(empresa, false, false).filter((t) => t.name === 'escalar_a_humano');
  const messages = [
    ...historial.map((m) => ({ role: m.rol === 'asistente' ? 'assistant' : 'user', content: m.contenido })),
    { role: 'user', content: mensajeEntrante },
  ];
  // Mismo resguardo que el camino de agendamiento: si el texto promete "te paso con una
  // persona" sin llamar a la herramienta, la conversación nunca se pausa de verdad.
  const pareceOfertaDeHumanoInventada = (texto) =>
    /te (paso|comunico|conecto|derivo)\s+(con|a)\s+(un|una|el|la)?\s*(ejecutivo|persona|agente|humano)/i.test(texto || '')
    || /(una\s+)?persona\s+del\s+equipo\s+(te\s+|se\s+|le\s+)?(contact|confirm|escrib|respond|llam|ayud)/i.test(texto || '')
    || /alguien\s+del\s+equipo\s+(te\s+|se\s+|le\s+)?(contact|confirm|escrib|respond|llam|ayud)/i.test(texto || '')
    // Cierre del guion ("te contactamos durante el día") sin llamar la herramienta. Solo
    // textos SIN "?": la apertura ("si prefieres, te llamamos... ¿Qué prefieres?") y las
    // preguntas ("¿a qué hora te llamamos?") usan los mismos verbos y no son un cierre.
    || (!!empresa.guionAtencion && !/\?/.test(texto || '')
      && /\bte\s+(contact|llam|escrib)(amos|aremos)\b|\bte\s+vamos\s+a\s+(contactar|llamar|escribir)|\bte\s+estaremos\s+(contactando|llamando|escribiendo)|\bnos\s+(comunicamos|comunicaremos|pondremos\s+en\s+contacto)\b/i.test(texto || ''))
    // Promesas en tercera persona, vistas en producción el 2026-10-23 sin que se pausara
    // el chat: "ya avisamos a nuestro equipo, en breve te contactan", "le paso el horario
    // a nuestro equipo para que te llamen".
    || (!!empresa.guionAtencion && !/\?/.test(texto || '')
      && /\bte\s+(contact|llam|escrib)(an|ar[aá]n)\b|\bpara\s+que\s+te\s+(contacten|llamen|escriban)\b|\b(ya\s+)?(avis[eé]|avisamos|le\s+paso|les\s+paso|paso\s+(el|tu|los)[^.!\n]{0,40}?)\s+(a|al)\s+(nuestro\s+|el\s+)?equipo\b/i.test(texto || ''));

  // Perú/Colombia preguntando el precio: aun con los precios en la información, el modelo
  // a veces derivaba en vez de darlos (prueba en staging 2026-10-24, misma pregunta: una
  // vez S/ 39, otra vez "te derivo"). Aquí no puede derivar (tool_choice none) y, si la
  // respuesta no trae la cifra del país, se manda un texto fijo con los precios.
  if (pais && pareceConsultaDePrecio(mensajeEntrante)) {
    const { mensual, hosting, dominio } = PAISES_GUION[pais];
    let texto = '';
    try {
      const response = await anthropic.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS_RESPUESTA, system: sistemaConCache(systemPrompt), tools: herramientas, tool_choice: { type: 'none' }, messages: mensajesConCache(messages),
      });
      registrarUsoCache('precio', response);
      const bloque = response.content.find((b) => b.type === 'text');
      texto = bloque ? bloque.text.trim() : '';
    } catch (error) {
      console.error('[claude.js] Precio por país: falló el modelo, va el texto fijo:', error.message);
    }
    const traeCifraDelPais = [mensual, hosting].some((precio) => texto.includes(precio.split(' al ')[0]));
    if (!traeCifraDelPais || pareceOfertaDeHumanoInventada(texto)) {
      texto = `El sitio web de una página + 2 correos corporativos cuesta ${mensual}, sin permanencia. El hosting cuesta ${hosting}, y el dominio ${dominio} lo pagas tú directamente al inscribirlo (te asesoramos sin costo). Todo lo que vaya más allá del ejemplo que te enviamos se cotiza aparte.\n\nCualquier otra duda, me cuentas 🙌`;
    }
    return { texto: empresa.guionAtencion ? quitarSaludoRepetido(texto, historial) : texto, interactivo: null };
  }

  // Con guion, al derivar se manda el cierre que escribió el modelo (con el nombre de
  // la persona); si al forzar la herramienta no vino texto, el del intento anterior.
  const CIERRE_POR_DEFECTO = '¡Dale! En un momento te contactamos directamente 🙌';
  let textoPrevio = '';
  let forzar = false;
  for (let intentos = 0; intentos < 2; intentos++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_RESPUESTA,
      system: sistemaConCache(systemPrompt),
      tools: herramientas,
      ...(forzar ? { tool_choice: { type: 'tool', name: 'escalar_a_humano' } } : {}),
      messages: mensajesConCache(messages),
    });
    registrarUsoCache('informativo', response);
    forzar = false;

    const textBlock = response.content.find((b) => b.type === 'text');
    const texto = textBlock ? textBlock.text.trim() : '';
    const usoHerramienta = response.content.find((b) => b.type === 'tool_use' && b.name === 'escalar_a_humano');
    if (usoHerramienta) {
      let cierre = empresa.guionAtencion ? (texto || textoPrevio) : '';
      if (empresa.guionAtencion && !cierre) {
        // A veces el modelo solo llama la herramienta, sin texto (visto en prueba 2026-10-23,
        // camino de la llamada): se le devuelve el resultado y se le pide el cierre del guion.
        cierre = await pedirCierreDelGuion(systemPrompt, herramientas, messages, response.content, usoHerramienta.id);
      }
      return { texto: cierre || CIERRE_POR_DEFECTO, interactivo: null, escaladoAHumano: true };
    }
    if (!texto) {
      console.error('[claude.js] Modo informativo sin texto -- stop_reason:', response.stop_reason, '| usage:', JSON.stringify(response.usage));
      // Un segundo intento antes de mandarle "¿puedes repetir?" a un interesado.
      if (intentos === 0) continue;
    }
    if (pareceOfertaDeHumanoInventada(texto)) {
      textoPrevio = texto;
      forzar = true;
      continue;
    }
    return {
      texto: (empresa.guionAtencion ? quitarSaludoRepetido(texto, historial) : texto) || 'Disculpa, ¿puedes repetir tu mensaje?',
      interactivo: null,
    };
  }
  return { texto: (empresa.guionAtencion && textoPrevio) || CIERRE_POR_DEFECTO, interactivo: null, escaladoAHumano: true };
}

// Red de seguridad determinística contra voseo. Confirmado en producción
// (2026-09-16, un día después de agregar una regla "ESTRICTA E
// INQUEBRANTABLE" al system prompt de arriba) que el modelo puede violarla
// igual -- no es un problema de redacción del prompt, es la misma
// limitación de confiabilidad ya documentada para tool_choice (ver
// memoria del proyecto). Mismo principio que el resto de las protecciones
// de este archivo: nunca confiar en que el modelo se corrija solo,
// corregir el texto final antes de mandarlo.
//
// Cada patrón cubre la forma CON y SIN tilde donde eso no genera
// ambigüedad con el tuteo real (ej. "tenés"/"tenes" nunca se confunde con
// "tienes", que es una palabra distinta) -- excepto los pares que
// comparten la misma raíz y solo se distinguen por el acento (ej.
// "necesitás" vs. "necesitas"), donde SOLO se corrige la forma con tilde
// explícita, para no tocar tuteo ya correcto (mismo cuidado que
// REGEX_VOSEO en scripts/_probar-nunca-vosea.js, que tuvo este error una
// vez).
const REEMPLAZOS_VOSEO = [
  [/\bvos\b/gi, 'tú'],
  [/\bten[eé]s\b/gi, 'tienes'],
  [/\bpod[eé]s\b/gi, 'puedes'],
  [/\bquer[eé]s\b/gi, 'quieres'],
  [/\bnecesitás\b/gi, 'necesitas'],
  [/\bsabés\b/gi, 'sabes'],
  [/\bven[ií]s\b/gi, 'vienes'],
  [/\bdec[ií]s\b/gi, 'dices'],
  [/\bsos\b/gi, 'eres'],
  [/\band[aá]s?\b/gi, (m) => (/s$/i.test(m) ? 'andas' : 'anda')],
  [/\bfijate\b/gi, 'fíjate'],
  [/\bescribime\b/gi, 'escríbeme'],
  [/\bdecime\b/gi, 'dime'],
  [/\bcontame\b/gi, 'cuéntame'],
  [/\bmandame\b/gi, 'mándame'],
  [/\bavisame\b/gi, 'avísame'],
  [/\bllamame\b/gi, 'llámame'],
  [/\besperame\b/gi, 'espérame'],
  [/\bmirá\b/gi, 'mira'],
];

function preservarMayuscula(original, reemplazo) {
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1);
  }
  return reemplazo;
}

function corregirVoseo(texto) {
  if (!texto) return texto;
  let resultado = texto;
  for (const [patron, reemplazo] of REEMPLAZOS_VOSEO) {
    resultado = resultado.replace(patron, (match) =>
      preservarMayuscula(match, typeof reemplazo === 'function' ? reemplazo(match) : reemplazo)
    );
  }
  return resultado;
}

async function generarRespuestaChatbot(params) {
  const resultado = await generarRespuestaChatbotSinCorregirVoseo(params);
  return { ...resultado, texto: corregirVoseo(resultado.texto) };
}

module.exports = {
  generarRespuestaChatbot,
  redactarMensajePaso,
  formatearConfirmacionCita,
  armarRespuestaHorarios,
  armarRespuestaProximosDias,
  extraerRutYTelefono,
  saludoSegunHoraChile,
  extraerDatosLeadWeb,
  paisDesdeTelefono,
};