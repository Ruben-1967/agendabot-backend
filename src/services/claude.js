const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const {
  obtenerHorariosDisponiblesPorBloque,
  obtenerProximosDiasConDisponibilidad,
  obtenerHorasDisponiblesPorBloqueParaServicio,
  obtenerProximosDiasParaServicio,
  resolverServicioParaHerramienta,
  crearCitaValidada,
} = require('./disponibilidad');

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
 * - agendar_cita exige el campo "rut" cuando empresa.requiereRut está activo.
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
  const agendarCitaProperties = {
    fecha: { type: 'string', description: 'Fecha de la cita, formato YYYY-MM-DD.' },
    hora: { type: 'string', description: "Hora de inicio, formato HH:MM (ej. '10:30')." },
    servicio: { type: 'string', description: 'Nombre del servicio solicitado, ej. "Examen de la vista".' },
    // Siempre se pide, sin importar requiereRut (decisión 2026-09-04): quien
    // escribe por WhatsApp no siempre es quien se atiende (ej. agenda para
    // un familiar), y el nombre de perfil de WhatsApp no es confiable —
    // reportado como falla real por el usuario.
    nombre: {
      type: 'string',
      description: "Nombre completo de la persona que se va a atender, tal como el cliente lo dice explícitamente en la conversación — NUNCA asumas el nombre de perfil de WhatsApp del contacto, siempre pregúntalo directamente (puede ser distinto de quien escribe, ej. agendando para un familiar).",
    },
  };
  const agendarCitaRequired = ['fecha', 'hora', 'servicio', 'nombre'];

  if (empresa.requiereRut) {
    agendarCitaProperties.rut = {
      type: 'string',
      description: "RUT del cliente (con guión, ej. '12345678-9'). Este negocio exige RUT para agendar.",
    };
    agendarCitaRequired.push('rut');
    agendarCitaProperties.telefono = {
      type: 'string',
      description: "Teléfono de contacto del cliente, tal como él lo dice explícitamente en la conversación — pregúntalo siempre, aunque le estés escribiendo desde el mismo número de WhatsApp (puede ser distinto, ej. alguien agendando por otra persona). Formato libre, tal como el cliente lo entregue.",
    };
    agendarCitaRequired.push('telefono');
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
      name: 'agendar_cita',
      description: empresa.requiereRut
        ? 'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora, servicio, nombre completo de quien se atiende Y RUT — este negocio exige nombre y RUT para agendar (nunca asumas el nombre del perfil de WhatsApp).'
        : 'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora, servicio y el nombre completo de quien se va a atender (nunca asumas el nombre del perfil de WhatsApp).',
      input_schema: {
        type: 'object',
        properties: agendarCitaProperties,
        required: agendarCitaRequired,
      },
    },
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
    if (resuelto.usaProfesionalFijo) {
      if (!resuelto.recursoId) {
        return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
      }
      const bloques = await obtenerHorariosDisponiblesPorBloque(resuelto.recursoId, input.fecha);
      return { fecha: input.fecha, horasDisponibles: bloques.flatMap((b) => b.horas), bloques };
    }
    const bloques = await obtenerHorasDisponiblesPorBloqueParaServicio(resuelto.servicioDb.id, input.fecha);
    return { fecha: input.fecha, horasDisponibles: bloques.flatMap((b) => b.horas), bloques };
  }

  if (nombre === 'consultar_proximos_dias_disponibles') {
    const resuelto = await resolverServicioParaHerramienta(empresa, recurso, input.servicio);
    let dias;
    if (resuelto.usaProfesionalFijo) {
      if (!resuelto.recursoId) {
        return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
      }
      dias = await obtenerProximosDiasConDisponibilidad(resuelto.recursoId, 7);
    } else {
      dias = await obtenerProximosDiasParaServicio(resuelto.servicioDb.id, 7);
    }
    return { dias: dias.map((d) => ({ fecha: d.fecha, primeraHora: d.horas[0] })) };
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

  if (nombre === 'agendar_cita') {
    // Validación y creación real delegadas a crearCitaValidada
    // (disponibilidad.js) -- mismo código que usa el camino de tap
    // determinístico (chatbotEngine.js), para que nunca haya 2 copias de
    // esta lógica que se puedan desincronizar. agendar_cita como tool de
    // Claude se retira del catálogo una vez que el camino de tap/reserva
    // determinística cubra todo el flujo (ver plan de refactor).
    return crearCitaValidada(
      { servicioNombre: input.servicio, fecha: input.fecha, hora: input.hora, nombre: input.nombre, rut: input.rut, telefono: input.telefono },
      { empresa, cliente, recurso }
    );
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
async function generarRespuestaChatbotSinCorregirVoseo({ empresa, cliente, historial, mensajeEntrante }) {
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
    ? `- Catálogo visual: si el cliente está en fase de indagación (todavía no llamaste a consultar_disponibilidad, consultar_proximos_dias_disponibles ni agendar_cita) y lo que pregunta calza con una categoría del catálogo, puedes ofrecerle proactivamente ver fotos — en TEXTO PLANO, con una pregunta breve, ej. "¿Quieres ver algunos ejemplos de [categoría]?". NUNCA llames a mostrar_catalogo_visual solo para hacer esa oferta.
- Llama a mostrar_catalogo_visual recién cuando el cliente confirme que quiere ver las fotos — sea porque respondió que sí a tu oferta, o porque las pidió directamente él mismo en cualquier momento (incluso con el agendamiento ya iniciado — un pedido explícito de fotos siempre se responde, sin excepción). Esto tiene prioridad sobre la obligación de llamar a una herramienta de agendamiento en ESE turno puntual: respondé primero con las fotos, y retomá el flujo de agendamiento en el mensaje siguiente, sin perder el contexto de lo que el cliente ya había confirmado antes de pedir ver fotos.
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
- El campo "servicio" en agendar_cita/consultar_disponibilidad sigue debiendo ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES, tal cual.
- La "información adicional" (si existe) es solo para responder preguntas puntuales que el cliente haga (precios, qué incluye un servicio, etc.) — nunca la uses para construir o ampliar la lista de servicios ofrecidos.
${instruccionServicioAgendar}
${instruccionesCatalogo}- En cuanto sepas el servicio (aunque sea en el mismo mensaje en que el cliente te lo dice, o porque lo eligió de la lista tocable), tu SIGUIENTE ACCIÓN es obligatoriamente llamar a una herramienta — nunca preguntar en texto si quiere ver los días, nunca ofrecerlo como opción, nunca preguntar "¿qué día te gustaría?". Actúa directo:
  - Si el cliente ya mencionó un día específico en algún momento de la conversación (ej. "el jueves", "mañana", una fecha), usa consultar_disponibilidad con esa fecha, inmediatamente.
  - Si el cliente NO ha mencionado ningún día todavía, usa consultar_proximos_dias_disponibles, inmediatamente, sin preguntar antes si quiere verlos.
  - Si el cliente pregunta puntualmente por un día de la semana o fecha concreta (ej. "¿tienen el domingo?", "¿atienden los lunes?") y ese día NO aparece entre los resultados que te devuelve la herramienta, tu texto de respuesta tiene que decirlo explícitamente antes de mostrar la lista (ej. "No atendemos los domingos, pero sí tenemos disponible:") — nunca te limites a reenviar la lista de días reales sin aclarar que el día puntual que preguntó no está, un cliente que no revise la lista con atención puede pensar que sí lo ofreciste.
- Tienes PROHIBIDO escribir frases como "¿qué día te gustaría?", "¿prefieres que te muestre los días disponibles?" o similares — esa decisión la tomas tú llamando a la herramienta correspondiente, nunca preguntándola en texto.
- NUNCA inventes horas ni días disponibles.
- Si acabas de mostrarle al cliente una lista de servicios u horarios y su siguiente mensaje es texto libre (no tocó ningún botón) pero de todas formas confirma claramente una de esas opciones ya mostradas (ej. mostraste horas "09:15, 09:45..." y responde "me sirve a las 09:15", "esa hora está bien", "el examen visual" o similar), trátalo exactamente igual que si hubiera tocado esa opción de la lista — nunca vuelvas a mostrar la misma lista ni a preguntar de nuevo lo que ya te confirmó. Solo vuelve a preguntar si su respuesta es realmente ambigua o no calza con ninguna opción mostrada.
- SIEMPRE pide el nombre completo de la persona que se va a atender antes de llamar a agendar_cita, sin importar el negocio — NUNCA asumas el nombre a partir del perfil de WhatsApp del contacto (quien escribe puede no ser quien se atiende, ej. agendando por un familiar), siempre pregúntalo explícitamente.
${empresa.requiereRut ? '- Este negocio además EXIGE RUT y teléfono de contacto para agendar. Antes de llamar a agendar_cita, pide estos 2 datos si aún no los tienes en la conversación — NUNCA asumas el teléfono a partir del número desde el que te escribe (puede ser distinto), siempre pregúntalo explícitamente.\n' : ''}- Una vez que el cliente confirme fecha, hora, servicio y nombre${empresa.requiereRut ? ', RUT y teléfono' : ''} específicos, usa agendar_cita para crear la cita de verdad. El campo "servicio" debe ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES.
- Si agendar_cita falla porque el horario ya no está disponible, discúlpate y ofrece consultar otra hora.
- Cuando confirmes una cita agendada, NUNCA muestres el "citaId" (es un identificador interno de la base de datos, sin ningún valor para el cliente) — el resumen debe incluir el nombre de quien se atiende, servicio, fecha, hora, y dirección si corresponde.
- Para la fecha del resumen, usa TAL CUAL el texto "fechaLegible" que te devuelve agendar_cita (o la fecha en español que ya te haya escrito el cliente al confirmar) — NUNCA calcules tú mismo a qué día de la semana corresponde una fecha ISO (ej. "2026-09-04"), es un cálculo que puedes hacer mal y ya generó una confirmación real con el día de la semana equivocado.
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

  // Detecta si un texto suena a que una cita quedó agendada — usado para no
  // confiar en una confirmación que el modelo redactó SIN haber llamado a
  // agendar_cita en ese turno (ver forzarAgendarCita más abajo). Solo se
  // considera si el turno anterior del bot fue la recapitulación pidiendo
  // confirmación final (ej. "¿Todo correcto?") — así no se dispara ante una
  // pregunta informativa posterior sobre una cita YA agendada de verdad
  // (ej. "¿quedó confirmada mi hora?"), que no debe volver a llamar la
  // herramienta.
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
  // seguidas (ej. consultar disponibilidad y luego agendar) antes de dar
  // la respuesta final en texto.
  let forzarHerramienta = null; // null | 'agendar_cita' | 'consultar_disponibilidad' | 'consultar_proximos_dias_disponibles' | 'escalar_a_humano' | 'mostrar_lista_servicios'
  for (let intentos = 0; intentos < 5; intentos++) {
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
      // cayendo en el mensaje genérico de abajo.
      max_tokens: 1500,
      system: systemPrompt,
      tools,
      ...(forzarHerramienta ? { tool_choice: { type: 'tool', name: forzarHerramienta } } : {}),
      messages,
    });
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

      // Bug real encontrado (Ahorróptica, cliente "yaye", 2026-09-01): en
      // el turno de confirmación final, el modelo a veces responde con
      // texto plano narrando "¡Listo! Tu cita ha sido agendada..." SIN
      // haber llamado a agendar_cita — el cliente queda creyendo que tiene
      // hora, pero no existe ninguna Cita real en la base. Reproducido en
      // vivo. Si el texto suena a esa confirmación, se descarta y se
      // reintenta UNA vez forzando la llamada real a la herramienta (con
      // los mismos datos ya reunidos en la conversación) en vez de confiar
      // en lo que el modelo redactó.
      if (pareceConfirmacionDeCita(texto)) {
        forzarHerramienta = 'agendar_cita';
        continue;
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
    let citaAgendadaConExito = null;
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
        }

        // Mismo mecanismo, pero para la lista de PRÓXIMOS DÍAS (cuando el
        // cliente no especificó fecha).
        if (block.name === 'consultar_proximos_dias_disponibles' && resultado.dias?.length > 0) {
          diasParaMostrar = resultado.dias;
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

        // Si agendar_cita tuvo éxito, cortamos el ciclo igual que los demás
        // atajos: el backend arma la confirmación con los datos reales que
        // devolvió la herramienta, en vez de dejar que Claude la redacte.
        // Encontrado un caso real (Ahorróptica, cliente "yaye", 2026-09-01):
        // Claude le dijo al cliente "¡Listo! Tu cita ha sido agendada
        // exitosamente" con un resumen completo, pero agendar_cita nunca se
        // había ejecutado en ese turno (o su resultado se ignoró) — el
        // Cliente quedó con 0 citas reales en la base. Reproducido en vivo
        // con el mismo guion de mensajes. Si en cambio falla (horario ya
        // no disponible), se deja seguir el ciclo normal para que Claude
        // pueda ofrecer una alternativa de forma natural.
        if (block.name === 'agendar_cita' && resultado.exito) {
          citaAgendadaConExito = { input: block.input, resultado };
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

    if (citaAgendadaConExito) {
      const { input, resultado } = citaAgendadaConExito;
      const fechaLegible = resultado.fechaLegible;
      return {
        texto: `¡Listo! Tu cita ha sido agendada exitosamente 🎉\n\n*Resumen de tu cita:*\n👤 *Nombre:* ${input.nombre}\n📋 *Servicio:* ${input.servicio}\n📅 *Fecha:* ${fechaLegible}\n🕐 *Hora:* ${input.hora}${empresa.direccion ? `\n📍 *Ubicación:* ${empresa.direccion}` : ''}${empresa.notaAgendamiento ? `\n\n${empresa.notaAgendamiento}` : ''}`,
        interactivo: null,
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

    if (horariosParaMostrar) {
      const fechaLegible = fechaLegibleDesdeISO(horariosParaMostrar.fecha);
      const horas = horariosParaMostrar.horas;
      const bloques = horariosParaMostrar.bloques;

      // Caso de siempre: un solo bloque real (sin break ese día) que cabe
      // completo en la lista interactiva de WhatsApp — Meta limita esa
      // lista a MAX_FILAS_LISTA_INTERACTIVA filas (ver whatsapp.js).
      if (bloques.length <= 1 && horas.length <= MAX_FILAS_LISTA_INTERACTIVA) {
        return {
          texto: `Estos son los horarios disponibles para el ${fechaLegible}: ${horas.join(', ')}. Elige el que más te acomode 👇`,
          interactivo: { tipo: 'lista_horarios', fecha: horariosParaMostrar.fecha, horas },
        };
      }

      // Demasiadas horas para la lista interactiva, o hay más de un bloque
      // real (ej. mañana y tarde separados por un break en el horario
      // configurado) — en vez de truncar a 10 y esconder horas reales, se
      // manda el listado completo en texto plano, un mensaje por bloque,
      // sin lista interactiva (no puede representar más de 10 opciones de
      // todas formas). El corte de bloques sale directo del horario real
      // configurado (HorarioSemanal puede tener varias filas el mismo día),
      // no de un corte fijo a las 12:00. Pedido por Ahorróptica 2026-09-03
      // — agenda de citas cada 15 min generaba demasiadas horas para un
      // solo mensaje. El bot ya reconoce que el cliente responda con la
      // hora en texto libre, sin necesidad de tocar una lista.
      const bloquesEtiquetados = bloques.map((b) => ({
        ...b,
        etiqueta: Number(b.horaInicio.split(':')[0]) < 12 ? 'la mañana' : 'la tarde',
      }));
      const texto = bloquesEtiquetados
        .map((b) => `Estos son los horarios disponibles en ${b.etiqueta} para el ${fechaLegible}: ${b.horas.join(', ')}.`)
        .join('\n\n') + '\n\n¿Cuál te acomoda? Escríbeme la hora que prefieras.';

      return {
        texto,
        interactivo: { tipo: 'horarios_por_bloque', fecha: horariosParaMostrar.fecha, bloques: bloquesEtiquetados },
      };
    }

    if (diasParaMostrar) {
      return {
        texto: armarTextoProximosDias(mensajeEntrante, diasParaMostrar),
        interactivo: { tipo: 'lista_dias', dias: diasParaMostrar },
      };
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

  return { texto: 'Disculpa, tuve un problema procesando tu solicitud. ¿Puedes intentar de nuevo?', interactivo: null };
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

module.exports = { generarRespuestaChatbot };