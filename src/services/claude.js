const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { obtenerHorariosDisponibles, crearCita, obtenerProximosDiasConDisponibilidad, obtenerHorasDisponiblesParaServicio, obtenerProximosDiasParaServicio } = require('./disponibilidad');
const { normalizarRut, esRutValido } = require('../lib/rut');

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

const MODEL = 'claude-haiku-4-5-20251001';

// Sin esto, un "rut" mal extraído por el modelo (texto libre, un id, lo que
// sea) se guardaba tal cual en Cliente.rut — visto en producción como un
// string larguísimo en la columna Rut del panel.
function normalizarYValidarRut(rutCrudo) {
  const normalizado = normalizarRut(rutCrudo);
  return esRutValido(normalizado) ? normalizado : null;
}

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
  };
  const agendarCitaRequired = ['fecha', 'hora', 'servicio'];

  if (empresa.requiereRut) {
    agendarCitaProperties.nombre = {
      type: 'string',
      description: "Nombre completo del cliente, tal como él lo dice explícitamente en la conversación — NUNCA asumas el nombre de perfil de WhatsApp del contacto, este negocio exige preguntarlo directamente.",
    };
    agendarCitaRequired.push('nombre');
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
        ? 'Crea una cita real en el sistema para el cliente actual, en una fecha y hora específicas que ya se confirmó que están disponibles. Solo usar después de que el cliente haya confirmado explícitamente fecha, hora, servicio, nombre completo Y RUT — este negocio exige nombre y RUT para agendar (nunca asumas el nombre del perfil de WhatsApp).'
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
 * Dado el nombre de servicio que Claude mandó, decide si el flujo de
 * disponibilidad/agendamiento debe usar el recurso fijo de la empresa
 * (comportamiento de siempre) o el modo "cualquier profesional vinculado"
 * (multi-profesional, OPCIÓN C).
 *
 * Si el nombre de servicio no calza con ningún Servicio real (empresa sin
 * servicios cargados, o typo), cae al comportamiento de siempre usando el
 * recurso fijo — así nunca se rompe nada para empresas como Ahorróptica
 * que no tienen Servicio.requiereProfesionalEspecifico configurado.
 *
 * @returns {Promise<{servicioDb: Object|null, usaProfesionalFijo: boolean, recursoId: string|null}>}
 */
async function resolverServicioParaHerramienta(empresa, recurso, nombreServicio) {
  const servicioDb = nombreServicio
    ? await prisma.servicio.findFirst({
        where: { empresaId: empresa.id, nombre: { equals: nombreServicio, mode: 'insensitive' } },
      })
    : null;

  if (!servicioDb || servicioDb.requiereProfesionalEspecifico) {
    return { servicioDb, usaProfesionalFijo: true, recursoId: recurso?.id || null };
  }

  return { servicioDb, usaProfesionalFijo: false, recursoId: null };
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
      const horas = await obtenerHorariosDisponibles(resuelto.recursoId, input.fecha);
      return { fecha: input.fecha, horasDisponibles: horas };
    }
    const horas = await obtenerHorasDisponiblesParaServicio(resuelto.servicioDb.id, input.fecha);
    return { fecha: input.fecha, horasDisponibles: horas };
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
    const resuelto = await resolverServicioParaHerramienta(empresa, recurso, input.servicio);
    if (resuelto.usaProfesionalFijo && !resuelto.recursoId) {
      return { error: 'Esta empresa no tiene un recurso agendable configurado todavía.' };
    }

    // Si la empresa exige RUT (y, junto con eso, nombre explícito), el
    // schema de la herramienta ya los marca como required — esto es un
    // resguardo extra por si Claude igual la llama sin alguno de los dos
    // campos. Si vienen, los guardamos en el Cliente (se sobreescriben si
    // venían vacíos o distintos, así queda actualizado a futuro) — nunca
    // confiamos en el nombre de perfil de WhatsApp para este caso.
    if (empresa.requiereRut) {
      if (!input.rut) {
        return { error: 'Este negocio exige RUT para agendar. Pide el RUT del cliente antes de reintentar.' };
      }
      if (!input.nombre) {
        return { error: 'Este negocio exige el nombre completo del cliente para agendar. Pídeselo explícitamente antes de reintentar — no asumas el nombre de perfil de WhatsApp.' };
      }
      if (!input.telefono) {
        return { error: 'Este negocio exige un teléfono de contacto para agendar. Pídeselo explícitamente antes de reintentar.' };
      }
      const rutValidado = normalizarYValidarRut(input.rut);
      if (!rutValidado) {
        return { error: `"${input.rut}" no tiene formato de RUT chileno válido (ej. 12345678-9). Pídeselo de nuevo al cliente antes de reintentar.` };
      }
      if (cliente.rut !== rutValidado || cliente.nombre !== input.nombre || cliente.telefono !== input.telefono) {
        await prisma.cliente.update({
          where: { id: cliente.id },
          data: { rut: rutValidado, nombre: input.nombre, telefono: input.telefono },
        });
      }
    }

   try {
      const cita = await crearCita({
        empresaId: empresa.id,
        clienteId: cliente.id,
        recursoAgendableId: resuelto.usaProfesionalFijo ? resuelto.recursoId : null,
        servicioId: resuelto.servicioDb?.id || null,
        fechaISO: input.fecha,
        horaInicio: input.hora,
      });
      // fechaLegible (en español, con día de la semana correcto) para que
      // la confirmación final la reutilice tal cual en vez de calcular ella
      // misma el día de semana a partir del ISO — ver nota en server.js
      // sobre la confirmación real que llegó con el día equivocado.
      return { exito: true, citaId: cita.id, fecha: input.fecha, fechaLegible: fechaLegibleDesdeISO(input.fecha), hora: input.hora };
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
  const tieneServiciosReales = serviciosReales.length > 0;

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

  const fechaHoyChile = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

  const tools = construirTools(empresa, tieneServiciosReales, incluirCatalogo);

  // Leer el tono de comunicación (default "Neutral")
  const tono = empresa.tonoComunicacion || 'Neutral';
  const instruccionesTono = {
    'Formal': 'Mantén un tono profesional y respetuoso. Usa usted, estructura las frases con cuidado, sé conciso y formal.',
    'Neutral': 'Usa un tono equilibrado — profesional pero cercano, tuteo es OK, sé breve y directo.',
    'Informal': 'Usa un tono conversacional y cercano. Sé amigable, puedes usar emojis ocasionales (no abuses), sé relajado pero siempre profesional.',
  };

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

  // Si el negocio tiene Servicio reales cargados, CUALQUIER pregunta sobre
  // qué servicios/atenciones ofrece (informativa o para agendar) debe
  // resolverse llamando a la herramienta — nunca en texto libre, y nunca
  // usando la información adicional para armar esa lista. Si todavía no
  // tiene Servicio reales, no hay herramienta disponible y se responde en
  // texto con la lista genérica del rubro.
  const instruccionServicioAgendar = tieneServiciosReales
    ? `- Si el cliente pregunta, de cualquier forma, qué servicios o atenciones ofrece el negocio — sea informativamente (ej. "servicios", "qué atienden", "qué hacen") o porque quiere agendar y no sabes cuál necesita — tu SIGUIENTE ACCIÓN es obligatoriamente llamar a mostrar_lista_servicios, inmediatamente. NUNCA escribas la lista de servicios en texto plano, y NUNCA la construyas ni la completes usando la "información adicional" — esa lista SOLO puede venir de esta herramienta.`
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

  const systemPrompt = `Eres el asistente de agendamiento de "${nombreEmpresa}", vía WhatsApp.
Hoy es ${fechaHoyChile} (zona horaria de Chile).

TONO DE COMUNICACIÓN:
${instruccionesTono[tono] || instruccionesTono['Neutral']}
Este tono aplica a TODA tu comunicación, incluida la interpretación de la "información adicional" que pueda estar cargada. Cuando cites información sobre precios, promociones o detalles del servicio, adáptalo al tono especificado sin cambiar su contenido.

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
${empresa.requiereRut ? '- Este negocio EXIGE nombre completo, RUT y teléfono de contacto para agendar. Antes de llamar a agendar_cita, además de fecha/hora/servicio, pide estos 3 datos si aún no los tienes en la conversación — NUNCA asumas el nombre a partir del perfil de WhatsApp del contacto, NUNCA asumas el teléfono a partir del número desde el que te escribe (puede ser distinto, ej. alguien agendando por otra persona), siempre pregúntalos explícitamente.\n' : ''}- Una vez que el cliente confirme fecha, hora${empresa.requiereRut ? ', servicio, nombre, RUT y teléfono' : ' y servicio'} específicos, usa agendar_cita para crear la cita de verdad. El campo "servicio" debe ser exactamente uno de los nombres de la lista SERVICIOS AGENDABLES.
- Si agendar_cita falla porque el horario ya no está disponible, discúlpate y ofrece consultar otra hora.
- Cuando confirmes una cita agendada, NUNCA muestres el "citaId" (es un identificador interno de la base de datos, sin ningún valor para el cliente) — el resumen debe incluir solo servicio, fecha, hora, y dirección si corresponde.
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

  // Bucle de tool use: Claude puede pedir usar una herramienta varias veces
  // seguidas (ej. consultar disponibilidad y luego agendar) antes de dar
  // la respuesta final en texto.
  let forzarAgendarCita = false;
  for (let intentos = 0; intentos < 5; intentos++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      tools,
      ...(forzarAgendarCita ? { tool_choice: { type: 'tool', name: 'agendar_cita' } } : {}),
      messages,
    });
    forzarAgendarCita = false;

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const texto = textBlock ? textBlock.text : '';

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
        forzarAgendarCita = true;
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
      }
    }

    if (citaAgendadaConExito) {
      const { input, resultado } = citaAgendadaConExito;
      const fechaLegible = resultado.fechaLegible;
      return {
        texto: `¡Listo! Tu cita ha sido agendada exitosamente 🎉\n\n*Resumen de tu cita:*\n📋 *Servicio:* ${input.servicio}\n📅 *Fecha:* ${fechaLegible}\n🕐 *Hora:* ${input.hora}${empresa.direccion ? `\n📍 *Ubicación:* ${empresa.direccion}` : ''}${empresa.notaAgendamiento ? `\n\n${empresa.notaAgendamiento}` : ''}`,
        interactivo: null,
      };
    }

    if (serviciosParaMostrar) {
      return {
        texto: '¿Para cuál de estos servicios necesitas la hora? 👇',
        interactivo: { tipo: 'lista_servicios', servicios: serviciosParaMostrar },
      };
    }

    if (horariosParaMostrar) {
      const fechaLegible = fechaLegibleDesdeISO(horariosParaMostrar.fecha);
      const horas = horariosParaMostrar.horas;
      // El texto debe enumerar como máximo las mismas horas que van a
      // aparecer como opciones seleccionables en la lista interactiva de
      // WhatsApp — Meta limita esa lista a MAX_FILAS_LISTA_INTERACTIVA filas
      // (ver whatsapp.js), así que enumerar más horas en el texto que en la
      // lista confundía al cliente (veía escrita una hora, ej. "12:15", que
      // después no aparecía como opción al tocar la lista). Reportado por
      // Ahorróptica 2026-09-01.
      const horasEnLista = horas.slice(0, MAX_FILAS_LISTA_INTERACTIVA);
      const hayMas = horas.length > horasEnLista.length;
      return {
        texto: hayMas
          ? `Estos son algunos de los horarios disponibles para el ${fechaLegible}: ${horasEnLista.join(', ')}. Elige el que más te acomode 👇 (si prefieres un horario más tarde ese día, cuéntame)`
          : `Estos son los horarios disponibles para el ${fechaLegible}: ${horasEnLista.join(', ')}. Elige el que más te acomode 👇`,
        interactivo: { tipo: 'lista_horarios', fecha: horariosParaMostrar.fecha, horas: horariosParaMostrar.horas },
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

module.exports = { generarRespuestaChatbot };