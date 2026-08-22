// src/services/demoEngine.js
//
// Orquesta la conversación de demo completa para prospectos. A diferencia
// de procesarMensajeEntrante (agendamiento real) y procesarMensajeCatalogoRotativo
// (catálogo real), este motor no ejecuta acciones reales — narra un guion de
// venta. El modo AGENDAMIENTO usa un generador de días/horas SIMULADO (ver
// src/lib/agendaDemoSimulada.js) — nunca depende de que la empresa de demo
// tenga agenda real cargada, y nunca escribe citas reales en la base.
//
// IMPORTANTE: el estado propio de la demo (en qué paso va, historial de la
// simulación, carrito o cita simulada) se guarda en el modelo DemoAsignada,
// NO en Conversacion. El historial registra ambos lados de la conversación,
// el servicio se VALIDA antes de aceptarlo (solo se pide nombre, ya no
// edad), el mismo teléfono puede pedir "reiniciar" la demo, los servicios
// se muestran como lista interactiva, una intención explícita de CONTRATAR
// salta directo al precio + link, y se puede pedir ver el panel de
// administración (link a /demo/panel) en cualquier momento.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { sincronizarLeadDesdeDemo } = require('./leadSync');
const { procesarMensajeCatalogoDemo } = require('./catalogoDemoEngine');
const {
  decodificarFilaHorario,
  decodificarFilaServicioDemo,
  ID_FILA_SERVICIO_OTRO_DEMO,
} = require('./whatsapp');
const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');
const { generarProximosDiasSimulados } = require('../lib/agendaDemoSimulada');
const { REMATE_PANEL_POR_RUBRO } = require('../config/remateDemoPanel');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LINK_LANDING = 'https://multidigital.cl/totemsystem';
const LINK_CONTRATACION = 'https://multidigital.cl/totemsystem#contratar';
const LINK_PANEL_DEMO = 'https://agendabot-backend-bbw5.onrender.com/demo/panel';

const PASOS = {
  INICIO: 0,
  SIMULACION_LIBRE: 1,
  ESPERANDO_PRODUCTOS: 2,
  PREGUNTAS_ABIERTAS: 3,
  DESAMBIGUANDO_PRECIO: 4,
  AGENDA_ESPERANDO_DATOS: 5,
  AGENDA_ESPERANDO_SERVICIO: 6,
  // Nombre de servicio ambiguo con una categoría de catálogo (ej. "Corte de
  // pelo" es servicio agendable Y categoría de CatalogoDemoItem a la vez).
  // Antes de asumir que el prospecto quiere agendar, se le pregunta si
  // quiere ver ejemplos primero — este paso sostiene esa pregunta hasta la
  // respuesta del turno siguiente.
  CATALOGO_ESPERANDO_CONFIRMACION: 7,
};

const GRILLA_PLANES_TEXTO = `- Plan A: $9.900 CLP/mes — 100 citas incluidas, excedente $150 CLP/cita
- Plan B: $19.900 CLP/mes — 300 citas incluidas, excedente $90 CLP/cita
- Plan C: $49.900 CLP/mes — 700 citas incluidas, excedente $60 CLP/cita
- Todos los planes incluyen, SIN costo adicional: 1 UF de hosting al año, recordatorios automáticos de
  confirmación (24h antes + reintentos) y promoción automática a la lista de espera cuando alguien cancela.
  WhatsApp no cobra por los mensajes de servicio dentro de la ventana de conversación del cliente, así que el
  costo real de operar es mínimo.`;

function detectaIntencionReiniciar(texto, modoOperacion) {
  const pideReinicio = /reiniciar|reinicia|reiniciemos|comenzar de nuevo|empezar de nuevo|volver a empezar|volvamos a empezar|desde el inicio|desde cero|de nuevo|nuevamente|otra vez|iniciar (la )?demo/i.test(texto);
  const mencionaEquipo = /mostrar(le|la|selo|sela)?\s+a\s+(mi|su|otro)\s+(equipo|jefe|socio|colega)/i.test(texto);

  if (mencionaEquipo) return true;
  if (!pideReinicio) return false;

  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return /\bdemo\b/i.test(texto);
  }
  return true;
}

// Señal de compra mucho más fuerte que "cuánto cuesta" — va directo al
// precio + link, sin pedir productos de ejemplo.
function detectaIntencionContratarDirecta(texto) {
  return /c[oó]mo (lo )?contrato|quiero contratar|me (gustar[ií]a|interesa) contratar|inscribirme|comenzar (ya|ahora)|firmar( el)? contrato|d[oó]nde contrato|contratar.*c[oó]mo (lo )?(hago|activo|empiezo)/i.test(texto);
}

// Detecta si el prospecto pregunta explícitamente por el panel de
// administración — distinto de preguntar por precio o servicios.
function detectaIntencionVerPanel(texto) {
  return /panel|administraci[oó]n|administrador|backend|dashboard|c[oó]mo (lo )?administr|c[oó]mo (veo|gestiono|manejo) (mis|las) citas/i.test(texto);
}

// La frase sobre el uso de marca cambia según quién asignó esta demo:
// - Un vendedor (demoAsignada.vendedorId presente) la personalizó para un
//   prospecto puntual con seguimiento humano de por medio — puede usar el
//   nombre real si el vendedor así lo decidió.
// - Sin vendedor (null) — viene del menú genérico o de una carga masiva sin
//   contacto previo (ej. base nacional de ópticas) — nunca se usa el nombre
//   real, para no sentirse invasivo con alguien que nunca habló con nosotros.
function fraseUsoMarca(demoAsignada) {
  return demoAsignada.vendedorId
    ? 'solo para esta prueba, no uso tu marca para nada más'
    : 'solo para esta prueba, pero aquí iría tu marca y la identificación de tu sucursal, en caso de que tengas';
}

function historialAMensajes(historial) {
  const recortado = historial.slice(-40);
  const mensajes = [];
  for (const turno of recortado) {
    const role = turno.rol === 'asistente' ? 'assistant' : 'user';
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo && ultimo.role === role) {
      ultimo.content += `\n${turno.texto}`;
    } else {
      mensajes.push({ role, content: turno.texto });
    }
  }
  while (mensajes.length && mensajes[0].role !== 'user') {
    mensajes.shift();
  }
  return mensajes;
}

function textoPrecios(modoOperacion) {
  if (modoOperacion === 'CATALOGO_ROTATIVO') {
    return `💳 Créditos prepagados: $149 CLP por mensaje enviado, mínimo 50 por compra. Pagas solo lo que usas.`;
  }
  return (
    `💰 *Plan A:* $9.900/mes — 100 citas incluidas\n` +
    `💰 *Plan B:* $19.900/mes — 300 citas incluidas\n` +
    `💰 *Plan C:* $49.900/mes — 700 citas incluidas\n` +
    `Los 3 incluyen 1 UF de hosting anual, recordatorios automáticos y lista de espera, sin costo extra.`
  );
}

function construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal }) {
  const listaFormateada = items.length > 0
    ? items.map((item) => `• ${item}`).join('\n')
    : '• (así se vería con tus productos reales)';

  const ejemploPersonalizado = modoOperacion === 'CATALOGO_ROTATIVO'
    ? `🛍️ *${empresaDemo.nombre}*\n\n${listaFormateada}`
    : `📅 *${empresaDemo.nombre}*\n\n${listaFormateada}`;

  const intro = origenCarritoReal
    ? `Justo con lo que ya probaste recién, así se vería con tu negocio 👇`
    : `Así se vería con tu negocio 👇`;

  return (
    `${intro}\n\n${ejemploPersonalizado}\n\n` +
    `Los negocios no suelen perder clientes por mal servicio — los pierden por no estar ahí ` +
    `justo cuando alguien los necesitaba.\n\n` +
    `${textoPrecios(modoOperacion)}\n\n` +
    `Detalle completo: ${LINK_LANDING}\n¿Seguimos? 👉 ${LINK_CONTRATACION}\n\n` +
    `_(¿tienes dudas de precio o condiciones? Pregúntame, sigo aquí — o si quieres ver cómo se ve el panel de administración, solo dímelo)_`
  );
}

async function responderPreguntaAbierta({ historial, modoOperacion }) {
  const systemPrompt = `Eres el mismo asistente de venta de Totemsystem que ya estuvo mostrando una demo.
Ahora el prospecto está haciendo preguntas de cierre (precio, condiciones, dudas). Responde en 2-4 líneas,
tono directo y cercano, como WhatsApp — nunca un párrafo largo. Ya tienes todo el historial de la
conversación arriba — úsalo para no perder el hilo (ej. si preguntó cuántas citas hace y luego solo
responde un número, entiende que es la respuesta a esa pregunta).

Grilla EXACTA de planes de agendamiento — usa estos números tal cual, NUNCA inventes ni redondees otros:
${GRILLA_PLANES_TEXTO}

Modo catálogo rotativo: créditos prepagados a $149 CLP por mensaje, mínimo 50 créditos por compra.
El producto responde WhatsApp 24/7, agenda o toma pedidos automáticamente, y se personaliza al rubro del negocio.

Regla estricta: NUNCA inventes políticas de cancelación, reembolso, garantías, plazos de prueba, ni
condiciones contractuales que no aparezcan arriba. Si preguntan algo así, sé honesto: di que esas
condiciones las confirma el equipo comercial directamente. No prometas nada que no esté en los datos de arriba.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemPrompt,
    messages: historialAMensajes(historial),
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Buena pregunta — te conecto con el equipo para que te lo confirmen bien.';
}

// Catálogo Visual de la demo (fijo por rubro, ver CatalogoDemoItem en el
// schema) — a diferencia del catálogo real, acá se le da tool-calling real
// de Anthropic a esta función (única en demoEngine.js que lo usa), porque
// el escenario de mayor impacto de venta (pedido explícito de fotos, sin
// perder el hilo) es demasiado delicado para replicarlo a mano con regex.
function remateParaRubro(empresaDemo) {
  return REMATE_PANEL_POR_RUBRO[empresaDemo.rubroTemplate.clave] || null;
}

function toolMostrarCatalogoVisualDemo() {
  return {
    name: 'mostrar_catalogo_visual_demo',
    description:
      'Muestra al prospecto fotos reales de una categoría del catálogo de ejemplo de este rubro (ej. cortes de pelo, armazones). Llámala SOLO cuando el prospecto ya confirmó que quiere ver las fotos — sea porque respondió que sí a tu oferta en texto, o porque las pidió directamente él mismo, en cualquier momento de la conversación. NUNCA la uses solo para preguntar si quiere verlas — esa oferta se hace en texto plano primero. El campo "categoria" debe ser exactamente uno de los nombres de la lista CATEGORÍAS DE CATÁLOGO DE EJEMPLO DISPONIBLES.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          description: 'Nombre exacto de la categoría, tal como aparece en la lista CATEGORÍAS DE CATÁLOGO DE EJEMPLO DISPONIBLES.',
        },
      },
      required: ['categoria'],
    },
  };
}

async function responderPreguntaSobreNegocio({ historial, empresaDemo, serviciosBase }) {
  // El switch (RubroTemplate.catalogoVisualDemoActivo) se chequea ANTES de
  // consultar items, igual que empresa.catalogoVisualActivo en el flujo
  // real — si está apagado, la tool ni se arma ni se ofrece.
  const itemsCatalogoDemo = empresaDemo.rubroTemplate.catalogoVisualDemoActivo
    ? await prisma.catalogoDemoItem.findMany({
        where: { rubroTemplateId: empresaDemo.rubroTemplateId, activo: true },
        orderBy: { orden: 'asc' },
      })
    : [];
  const categoriasCatalogoDemo = [...new Set(itemsCatalogoDemo.map((i) => i.categoria))];
  const incluirCatalogo = categoriasCatalogoDemo.length > 0;

  const bloqueCategorias = incluirCatalogo
    ? `\nCATEGORÍAS DE CATÁLOGO DE EJEMPLO DISPONIBLES (fotos reales que puedes ofrecer — el campo "categoria" de mostrar_catalogo_visual_demo debe ser exactamente uno de estos nombres):\n${categoriasCatalogoDemo.map((c) => `- ${c}`).join('\n')}\n`
    : '';
  const instruccionesCatalogo = incluirCatalogo
    ? `\n- Catálogo de ejemplo: si lo que pregunta el prospecto calza con una categoría del catálogo, puedes ofrecerle proactivamente ver fotos — en TEXTO PLANO, con una pregunta breve, ej. "¿Quieres ver algunos ejemplos de [categoría]?". NUNCA llames a mostrar_catalogo_visual_demo solo para hacer esa oferta.
- Llama a mostrar_catalogo_visual_demo recién cuando el prospecto confirme que quiere ver las fotos — sea porque respondió que sí a tu oferta, o porque las pidió directamente él mismo en cualquier momento.`
    : '';

  const systemPrompt = `Eres el asistente de WhatsApp de "${empresaDemo.nombre}" (esto es una demo comercial de Totemsystem).
Servicios que ofrece: ${serviciosBase.length ? serviciosBase.join(', ') : 'servicios generales del rubro'}.
${empresaDemo.direccion ? `Dirección: ${empresaDemo.direccion}.` : ''}
${empresaDemo.sitioWeb ? `Sitio web: ${empresaDemo.sitioWeb}` : ''}
${empresaDemo.informacionAdicional ? `Información adicional que puedes citar tal cual: ${empresaDemo.informacionAdicional}` : ''}
${bloqueCategorias}
Ya tienes arriba el historial completo de la conversación — úsalo para no perder el hilo. Responde en 1-3
líneas, tono cordial y directo, como WhatsApp. Si preguntan por agendar, invítalos a decir el servicio que
quieren para mostrarles los horarios disponibles. NUNCA inventes precios, horarios exactos, ni políticas que
no te dieron arriba — si no lo sabes, dilo con naturalidad.${instruccionesCatalogo}`;

  const messages = historialAMensajes(historial);
  const tools = incluirCatalogo ? [toolMostrarCatalogoVisualDemo()] : undefined;

  for (let intentos = 0; intentos < 3; intentos++) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      ...(tools ? { tools } : {}),
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return { texto: textBlock ? textBlock.text : '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.', interactivo: null };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    let catalogoParaMostrar = null;

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'mostrar_catalogo_visual_demo') {
        const itemsCategoria = itemsCatalogoDemo
          .filter((i) => i.categoria.toLowerCase() === String(block.input.categoria || '').toLowerCase())
          .slice(0, 4);
        const resultado = itemsCategoria.length > 0
          ? { categoria: itemsCategoria[0].categoria, items: itemsCategoria.map((i) => ({ nombre: i.nombre, imagenUrl: i.imagenUrl })) }
          : { error: 'No encontramos esa categoría del catálogo.' };
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultado) });
        if (resultado.items?.length > 0) catalogoParaMostrar = resultado;
      }
    }

    if (catalogoParaMostrar) {
      return {
        texto: `Aquí tienes algunos ejemplos de ${catalogoParaMostrar.categoria} 👇`,
        interactivo: { tipo: 'catalogo_imagenes_demo', items: catalogoParaMostrar.items, remate: remateParaRubro(empresaDemo) },
      };
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { texto: '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.', interactivo: null };
}

// Interceptor determinístico para los pasos de agendamiento en curso
// (AGENDA_ESPERANDO_SERVICIO / AGENDA_ESPERANDO_DATOS), que no pasan por
// Claude — si no se detecta acá, el texto se interpretaría literalmente
// como el servicio o el nombre del prospecto. No cambia nuevoPaso, así que
// el turno siguiente sigue esperando exactamente lo mismo que antes.
function detectaIntencionVerFotosDemo(texto) {
  return /\bfotos?\b|\bim[aá]genes?\b|\bejemplos?\b|\bmuestras?\b/i.test(texto);
}

/**
 * @param {Object} empresaDemo
 * @param {string|null} categoriaTexto - si se pasa, filtra a esa categoría
 *   exacta (case-insensitive) — usado para la confirmación por ambigüedad
 *   nombre-de-servicio/categoría. Sin filtro, trae cualquier item del rubro
 *   (usado por el interceptor de fotos durante agendamiento en curso).
 */
async function intentarMostrarCatalogoDemo(empresaDemo, categoriaTexto = null) {
  if (!empresaDemo.rubroTemplate.catalogoVisualDemoActivo) return null;

  const items = await prisma.catalogoDemoItem.findMany({
    where: {
      rubroTemplateId: empresaDemo.rubroTemplateId,
      activo: true,
      ...(categoriaTexto ? { categoria: { equals: categoriaTexto, mode: 'insensitive' } } : {}),
    },
    orderBy: { orden: 'asc' },
    take: 4,
  });
  if (items.length === 0) return null;

  return {
    texto: categoriaTexto
      ? `Aquí tienes algunos ejemplos de ${items[0].categoria} 👇`
      : 'Antes de seguir, aquí tienes algunos ejemplos 👇',
    interactivo: {
      tipo: 'catalogo_imagenes_demo',
      items: items.map((i) => ({ nombre: i.nombre, imagenUrl: i.imagenUrl })),
      remate: remateParaRubro(empresaDemo),
    },
  };
}

/**
 * Chequeo liviano (sin traer las imágenes) para saber si conviene ofrecer
 * el catálogo de una categoría puntual — usado para decidir si preguntar
 * "¿quieres ver ejemplos?" cuando un nombre de servicio es ambiguo con una
 * categoría de catálogo real.
 */
async function hayCatalogoParaCategoria(empresaDemo, categoriaTexto) {
  if (!empresaDemo.rubroTemplate.catalogoVisualDemoActivo) return false;
  const count = await prisma.catalogoDemoItem.count({
    where: {
      rubroTemplateId: empresaDemo.rubroTemplateId,
      activo: true,
      categoria: { equals: categoriaTexto, mode: 'insensitive' },
    },
  });
  return count > 0;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PALABRAS_VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'del', 'al']);

function normalizarTexto(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function palabrasSignificativas(s) {
  return normalizarTexto(s).split(/\s+/).filter((p) => p && !PALABRAS_VACIAS.has(p));
}

function detectarServicioMencionado(texto, serviciosBase) {
  const textoNorm = normalizarTexto(texto);

  // Paso 1: coincidencia completa.
  for (const servicio of serviciosBase) {
    const palabras = palabrasSignificativas(servicio);
    if (palabras.length > 0 && palabras.every((p) => textoNorm.includes(p))) {
      return servicio;
    }
  }

  // Paso 2: coincidencia parcial (una sola palabra clave), solo si es
  // inequívoca (un único servicio candidato) Y el mensaje es corto (máx 3
  // palabras significativas). Mensajes largos suelen ser respuestas
  // conversacionales a otra pregunta (ej. "no tengo receta pero es sin
  // cristales ópticos") — compartir una sola palabra con el nombre de un
  // servicio no debe secuestrar la conversación en ese caso.
  const palabrasTexto = palabrasSignificativas(texto);
  if (palabrasTexto.length > 3) return null;

  const candidatos = serviciosBase.filter((servicio) => {
    const palabras = palabrasSignificativas(servicio);
    return palabras.some((p) => new RegExp(`\\b${escaparRegex(p)}\\b`, 'i').test(textoNorm));
  });

  return candidatos.length === 1 ? candidatos[0] : null;
}

function detectaIntencionAgendarGenerico(texto) {
  return /agendar|reservar|\bhoras?\b|\bhorarios?\b|\bcita\b|\bturno\b/i.test(texto);
}

// Arma el interactivo de servicios como lista tocable, con "Otro/no lo
// encuentro" al final — mismo patrón que el chatbot real.
function interactivoListaServiciosDemo(serviciosBase) {
  return { tipo: 'lista_servicios_demo', servicios: serviciosBase };
}

async function procesarMensajeDemo({ demoAsignada, telefonoCliente, mensaje, nombreContacto }) {
  const empresaDemo = demoAsignada.empresaDemo;
  const modoOperacion = empresaDemo.rubroTemplate.modoOperacion;
  const paso = demoAsignada.paso || PASOS.INICIO;
  const historial = Array.isArray(demoAsignada.historialSimulacion) ? demoAsignada.historialSimulacion : [];
  const carritoActual = Array.isArray(demoAsignada.carritoDemoJson) ? demoAsignada.carritoDemoJson : [];
  const serviciosBase = Array.isArray(empresaDemo.rubroTemplate.serviciosBase)
    ? empresaDemo.rubroTemplate.serviciosBase
    : [];

  const horarioElegido = mensaje.type === 'interactive'
    ? decodificarFilaHorario(mensaje.interactive?.list_reply?.id)
    : null;

  const idFilaElegida = mensaje.type === 'interactive'
    ? mensaje.interactive?.list_reply?.id
    : null;

  const textoEntrante = horarioElegido
    ? `Confirmo que quiero agendar para el ${horarioElegido.fecha} a las ${horarioElegido.hora}.`
    : mensaje.type === 'button'
      ? (mensaje.button?.text || '')
      : (mensaje.type === 'interactive'
        ? (mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '')
        : (mensaje.text?.body || ''));

  // Reinicio manual de la demo, sin importar en qué paso esté hoy.
  
  if (mensaje.type === 'text' && detectaIntencionReiniciar(textoEntrante, modoOperacion)) {
    const nombreParaSaludo = demoAsignada.nombreProspecto || nombreContacto;
    const respuestaTexto =
      `¡Dale! 🔄 Reiniciamos la demo desde cero.\n\n` +
      `¡Hola${nombreParaSaludo ? ` ${nombreParaSaludo}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
      `Te voy a responder como si fuera *"${empresaDemo.nombre}"* — ${fraseUsoMarca(demoAsignada)}.\n\n` +
      `Pruébalo tú mismo — escríbeme algo, como si fueras un cliente tuyo 👇`;

    await prisma.demoAsignada.update({
      where: { id: demoAsignada.id },
      data: {
        paso: PASOS.SIMULACION_LIBRE,
        historialSimulacion: [{ rol: 'asistente', texto: respuestaTexto }],
        citaDemoJson: null,
        carritoDemoJson: [],
        // Reinicio manual = borrón y cuenta nueva también para el
        // seguimiento automático post-demo (ver seguimientoDemo.js).
        intencionPrecioDetectada: false,
        intencionPrecioEn: null,
        ultimaInteraccionEn: null,
        seguimientosEnviados: 0,
        seguimientoTipo: null,
        seguimientoEnviadoEn: null,
        derivadoAVendedor: false,
        derivadoEn: null,
        motivoDerivacion: null,
        // A diferencia de los campos de arriba, primerMensajeProspectoEn NO
        // es parte del "borrón y cuenta nueva" — es un marcador histórico
        // permanente (el negocio sí probó la demo alguna vez), así que solo
        // se escribe si todavía estaba en null, nunca se limpia.
        ...(demoAsignada.primerMensajeProspectoEn ? {} : { primerMensajeProspectoEn: new Date() }),
      },
    });

    return { respuestaTexto, interactivo: null };
  }

  let nuevoHistorial = [...historial, { rol: 'prospecto', texto: textoEntrante }];
  const esPrimerMensajeProspecto = !demoAsignada.primerMensajeProspectoEn;

  let respuestaTexto;
  let interactivo = null;
  let nuevoPaso = paso;
  let nuevoCitaDemo = demoAsignada.citaDemoJson || null;
  let yaResuelto = false;
  // Señal para el seguimiento automático post-demo (ver seguimientoDemo.js)
  // — se marca en el mismo punto donde ya se detecta la intención de precio.
  let detectoIntencionPrecioEsteTurno = false;

  // Selección de un SERVICIO real de la lista tocable (o "Otro/no lo
  // encuentro"), en modo AGENDAMIENTO. Se resuelve antes del switch.
  if (mensaje.type === 'interactive' && modoOperacion === 'AGENDAMIENTO') {
    if (idFilaElegida === ID_FILA_SERVICIO_OTRO_DEMO) {
      try {
        const respuestaNegocio = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
        respuestaTexto = respuestaNegocio.texto;
        interactivo = respuestaNegocio.interactivo;
      } catch (error) {
        console.error('[DEMO] Error respondiendo tras "otro/no lo encuentro":', error.message);
        respuestaTexto = '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
      }
      nuevoPaso = PASOS.SIMULACION_LIBRE;
      yaResuelto = true;
    } else {
      const indiceServicio = decodificarFilaServicioDemo(idFilaElegida);
      if (indiceServicio != null && serviciosBase[indiceServicio]) {
        nuevoCitaDemo = { servicio: serviciosBase[indiceServicio] };
        respuestaTexto = '¡Perfecto! Estos son los próximos días disponibles:';
        interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        yaResuelto = true;
      }
    }
  }

  if (!yaResuelto && horarioElegido && modoOperacion === 'AGENDAMIENTO') {
    nuevoCitaDemo = { ...(nuevoCitaDemo || {}), fecha: horarioElegido.fecha, hora: horarioElegido.hora };
    const fechaLegible = fechaLegibleDesdeISO(horarioElegido.fecha);

    respuestaTexto = `Perfecto, ${fechaLegible} a las ${horarioElegido.hora}. Para dejarlo agendado, dime tu *nombre completo*.`;
    nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
    yaResuelto = true;
  }

  if (!yaResuelto) {
    switch (paso) {
 
 case PASOS.INICIO: {
        const nombreParaSaludo = demoAsignada.nombreProspecto || nombreContacto;
        respuestaTexto =
          `¡Hola${nombreParaSaludo ? ` ${nombreParaSaludo}` : ''}! 👋 Soy el asistente de *Totemsystem*.\n\n` +
          `Te voy a responder como si fuera *"${empresaDemo.nombre}"* — ${fraseUsoMarca(demoAsignada)}.\n\n` +
          `Pruébalo tú mismo — ` +
          `escríbeme algo, como si fueras un cliente tuyo 👇`;
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.SIMULACION_LIBRE: {
        if (detectaIntencionContratarDirecta(textoEntrante)) {
          const items = carritoActual.length > 0 ? carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`) : [];
          respuestaTexto = construirMockupYPitch({
            items, empresaDemo, modoOperacion, origenCarritoReal: carritoActual.length > 0,
          });
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        if (detectaIntencionVerPanel(textoEntrante)) {
          respuestaTexto = `¡Con gusto! Así se ve el panel donde administras todo 👇\n${LINK_PANEL_DEMO}`;
          nuevoPaso = PASOS.SIMULACION_LIBRE;
          break;
        }

        const hablaDePagoDelNegocio = /medios?\s+de\s+pago|formas?\s+de\s+pago|plan(es)?\s+de\s+pago/i.test(textoEntrante);
        const pareceQuererPrecio = !hablaDePagoDelNegocio &&
          /precio|beneficios?|cu[aá]nto (sale|vale|cobra|cuesta|es)|tarifa|\bcosto\b|\bplan(es)?\b|contrat(ar|o)|cotiza|totemsystem/i.test(textoEntrante);

        if (pareceQuererPrecio) {
          detectoIntencionPrecioEsteTurno = true;
          const esInequivoco = /totemsystem/i.test(textoEntrante);

          if (esInequivoco) {
            if (modoOperacion === 'CATALOGO_ROTATIVO' && carritoActual.length > 0) {
              const items = carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`);
              respuestaTexto = construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal: true });
              nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
            } else {
              respuestaTexto = `¡Con gusto! Para darte un ejemplo con tu negocio real: dime 2 o 3 productos o servicios que ofreces, separados por coma.`;
              nuevoPaso = PASOS.ESPERANDO_PRODUCTOS;
            }
            break;
          }

          respuestaTexto = '¿Tu pregunta es sobre...? 👇';
          interactivo = {
            tipo: 'lista_desambiguacion_precio',
            opciones: [
              {
                id: 'precio_producto',
                titulo: modoOperacion === 'CATALOGO_ROTATIVO' ? 'Precio de un producto' : 'Precio de un servicio',
                descripcion: 'Sigo probando el negocio',
              },
              {
                id: 'precio_totemsystem',
                titulo: 'Precio de Totemsystem',
                descripcion: 'El servicio de esta demo',
              },
            ],
          };
          nuevoPaso = PASOS.DESAMBIGUANDO_PRECIO;
          break;
        }

        if (modoOperacion === 'AGENDAMIENTO') {
          const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

          if (servicioMencionado) {
            // Nombre ambiguo: existe como servicio agendable Y como
            // categoría de catálogo (ej. "Corte de pelo"). Si el prospecto
            // todavía no expresó intención de agendar (ni antes en esta
            // conversación, ni en este mismo mensaje), preguntamos primero
            // si quiere ver ejemplos — no asumimos agendamiento directo.
            const yaExpresoIntencionAgendar =
              Boolean(nuevoCitaDemo?.servicio || nuevoCitaDemo?.fecha) ||
              detectaIntencionAgendarGenerico(textoEntrante);

            if (!yaExpresoIntencionAgendar && await hayCatalogoParaCategoria(empresaDemo, servicioMencionado)) {
              nuevoCitaDemo = { ...(nuevoCitaDemo || {}), servicio: servicioMencionado };
              respuestaTexto = `¿Quieres ver algunos ejemplos de ${servicioMencionado} antes de agendar? Es solo una muestra pequeña de los muchos diseños que podemos ofrecerte 😊`;
              nuevoPaso = PASOS.CATALOGO_ESPERANDO_CONFIRMACION;
              break;
            }

            nuevoCitaDemo = { servicio: servicioMencionado };
            respuestaTexto = '¡Claro! Estos son los próximos días disponibles:';
            interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }

          if (detectaIntencionAgendarGenerico(textoEntrante) && serviciosBase.length > 0) {
            respuestaTexto = '¡Claro! ¿Para cuál de estos servicios? 👇';
            interactivo = interactivoListaServiciosDemo(serviciosBase);
            nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
            break;
          }

          try {
            const respuestaNegocio = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
            respuestaTexto = respuestaNegocio.texto;
            interactivo = respuestaNegocio.interactivo;
          } catch (error) {
            console.error('[DEMO] Error respondiendo pregunta libre de agendamiento:', error.message);
            respuestaTexto = '¿En qué te puedo ayudar? Puedo contarte de nuestros servicios o agendarte una hora.';
          }
          nuevoPaso = PASOS.SIMULACION_LIBRE;
          break;
        }

        let respuestaMotorReal = null;
        let interactivoMotorReal = null;
        try {
          const resultado = await procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje });
          respuestaMotorReal = resultado?.respuestaTexto || null;
          interactivoMotorReal = resultado?.interactivo || null;
        } catch (error) {
          console.error('[DEMO] Error delegando al motor de catálogo, se usa fallback:', error.message);
        }
        respuestaTexto = respuestaMotorReal || 'Cuéntame más — ¿qué te gustaría hacer?';
        interactivo = interactivoMotorReal;
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.CATALOGO_ESPERANDO_CONFIRMACION: {
        // Respuesta a "¿quieres ver ejemplos de [servicio] antes de
        // agendar?" (ver SIMULACION_LIBRE). Si declina o pide hora/día
        // directamente, seguimos a agendar -- el servicio ya quedó
        // guardado en nuevoCitaDemo cuando se hizo la pregunta.
        const declinaOPideAgendar =
          /\bno\b/i.test(textoEntrante) ||
          detectaIntencionAgendarGenerico(textoEntrante) ||
          /\b(hora|horario|d[ií]a|fecha)\b/i.test(textoEntrante);

        if (!declinaOPideAgendar) {
          const resultado = await intentarMostrarCatalogoDemo(empresaDemo, nuevoCitaDemo?.servicio);
          if (resultado) {
            respuestaTexto = resultado.texto;
            interactivo = resultado.interactivo;
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }
        }

        respuestaTexto = '¡Dale! Estos son los próximos días disponibles:';
        interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.AGENDA_ESPERANDO_SERVICIO: {
        if (detectaIntencionVerFotosDemo(textoEntrante)) {
          const resultadoFotos = await intentarMostrarCatalogoDemo(empresaDemo);
          if (resultadoFotos) {
            respuestaTexto = resultadoFotos.texto;
            interactivo = resultadoFotos.interactivo;
            nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
            break;
          }
        }

        const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

        if (!servicioMencionado) {
          respuestaTexto = 'No alcancé a reconocer ese servicio — elige uno de estos 👇';
          interactivo = interactivoListaServiciosDemo(serviciosBase);
          nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
          break;
        }

        nuevoCitaDemo = { servicio: servicioMencionado };
        respuestaTexto = '¡Perfecto! Estos son los próximos días disponibles:';
        interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
        nuevoPaso = PASOS.SIMULACION_LIBRE;
        break;
      }

      case PASOS.AGENDA_ESPERANDO_DATOS: {
        if (detectaIntencionVerFotosDemo(textoEntrante)) {
          const resultadoFotos = await intentarMostrarCatalogoDemo(empresaDemo);
          if (resultadoFotos) {
            respuestaTexto = resultadoFotos.texto;
            interactivo = resultadoFotos.interactivo;
            nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
            break;
          }
        }

        const nombreProspecto = textoEntrante.trim();

        if (nombreProspecto.length < 2) {
          respuestaTexto = 'No alcancé a leer bien tu nombre — ¿me lo repites?';
          nuevoPaso = PASOS.AGENDA_ESPERANDO_DATOS;
          break;
        }

        nuevoCitaDemo = { ...(nuevoCitaDemo || {}), nombre: nombreProspecto };
        const fechaLegible = nuevoCitaDemo.fecha ? fechaLegibleDesdeISO(nuevoCitaDemo.fecha) : 'el día elegido';

        respuestaTexto =
          `📋 *Resumen de tu cita en ${empresaDemo.nombre}*\n\n` +
          `${nuevoCitaDemo.servicio ? `• Servicio: ${nuevoCitaDemo.servicio}\n` : ''}` +
          `• Día: ${fechaLegible}\n` +
          `• Hora: ${nuevoCitaDemo.hora || '-'}\n` +
          `• Nombre: ${nombreProspecto}\n\n` +
          `✅ Listo, quedaste agendado.\n\n` +
          `Y algo que a los negocios les encanta: 24 horas antes te llegaría un recordatorio automático por este ` +
          `mismo WhatsApp. Si no puedes asistir, solo respondes "No" y tu cupo se libera al instante — y se le ` +
          `ofrece automáticamente a la primera persona en lista de espera. Cero llamadas, cero planillas.`;

        nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
        break;
      }

     case PASOS.DESAMBIGUANDO_PRECIO: {
        // Tocar este botón es una elección explícita e inequívoca — va
        // directo al pitch, sin volver a preguntar nada. En modo
        // AGENDAMIENTO no existe "carrito", así que usamos el servicio ya
        // elegido en la demo (si hay uno) como ejemplo; si no hay ninguno
        // todavía, el pitch genérico ya contempla ese caso.
        if (idFilaElegida === 'precio_totemsystem') {
          if (modoOperacion === 'CATALOGO_ROTATIVO') {
            const items = carritoActual.length > 0 ? carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`) : [];
            respuestaTexto = construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal: carritoActual.length > 0 });
          } else {
            const items = nuevoCitaDemo?.servicio ? [nuevoCitaDemo.servicio] : [];
            respuestaTexto = construirMockupYPitch({ items, empresaDemo, modoOperacion, origenCarritoReal: items.length > 0 });
          }
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        nuevoPaso = PASOS.SIMULACION_LIBRE;

        if (modoOperacion === 'AGENDAMIENTO') {
          try {
            const respuestaNegocio = await responderPreguntaSobreNegocio({ historial: nuevoHistorial, empresaDemo, serviciosBase });
            respuestaTexto = respuestaNegocio.texto;
            interactivo = respuestaNegocio.interactivo;
          } catch (error) {
            console.error('[DEMO] Error respondiendo tras desambiguación:', error.message);
            respuestaTexto = 'Cuéntame más — ¿qué te gustaría hacer?';
          }
          break;
        }

        try {
          const resultado = await procesarMensajeCatalogoDemo({ demoAsignada, textoEntrante, mensaje });
          respuestaTexto = resultado?.respuestaTexto || 'Cuéntame más — ¿qué te gustaría hacer?';
          interactivo = resultado?.interactivo || null;
        } catch (error) {
          console.error('[DEMO] Error delegando tras desambiguación, se usa fallback:', error.message);
          respuestaTexto = 'Cuéntame más — ¿qué te gustaría hacer?';
        }
        break;
      }

      case PASOS.ESPERANDO_PRODUCTOS: {
        const itemsIngresados = textoEntrante
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5);

        respuestaTexto = construirMockupYPitch({
          items: itemsIngresados,
          empresaDemo,
          modoOperacion,
          origenCarritoReal: false,
        });

        nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
        break;
      }

      case PASOS.PREGUNTAS_ABIERTAS:
      default: {
        if (detectaIntencionContratarDirecta(textoEntrante)) {
          const items = carritoActual.length > 0 ? carritoActual.map((it) => `${it.cantidad}x ${it.nombre}`) : [];
          respuestaTexto = construirMockupYPitch({
            items, empresaDemo, modoOperacion, origenCarritoReal: carritoActual.length > 0,
          });
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        if (detectaIntencionVerPanel(textoEntrante)) {
          respuestaTexto = `¡Con gusto! Así se ve el panel donde administras todo 👇\n${LINK_PANEL_DEMO}`;
          nuevoPaso = PASOS.PREGUNTAS_ABIERTAS;
          break;
        }

        if (modoOperacion === 'AGENDAMIENTO') {
          const servicioMencionado = detectarServicioMencionado(textoEntrante, serviciosBase);

          if (servicioMencionado) {
            nuevoCitaDemo = { servicio: servicioMencionado };
            respuestaTexto = '¡Claro! Estos son los próximos días disponibles:';
            interactivo = { tipo: 'lista_dias', dias: generarProximosDiasSimulados() };
            nuevoPaso = PASOS.SIMULACION_LIBRE;
            break;
          }

          if (detectaIntencionAgendarGenerico(textoEntrante) && serviciosBase.length > 0) {
            respuestaTexto = '¡Claro! ¿Para cuál de estos servicios? 👇';
            interactivo = interactivoListaServiciosDemo(serviciosBase);
            nuevoPaso = PASOS.AGENDA_ESPERANDO_SERVICIO;
            break;
          }
        }

        try {
          respuestaTexto = await responderPreguntaAbierta({ historial: nuevoHistorial, modoOperacion });
        } catch (error) {
          console.error('[DEMO] Error respondiendo pregunta abierta:', error.message);
          respuestaTexto = `Buena pregunta — te conecto con el equipo para confirmártelo bien. Mientras, puedes ver más acá: ${LINK_LANDING}`;
        }
        break;
      }
    }
  }

  nuevoHistorial = [...nuevoHistorial, { rol: 'asistente', texto: respuestaTexto }].slice(-40);

  const datosActualizacion = {
    paso: nuevoPaso,
    historialSimulacion: nuevoHistorial,
    citaDemoJson: nuevoCitaDemo,
    // ultimaInteraccionEn se actualiza SIEMPRE, sin condición — es la base
    // de la ventana de 24h y del umbral de inactividad del seguimiento
    // automático post-demo (ver seguimientoDemo.js).
    ultimaInteraccionEn: new Date(),
  };

  // primerMensajeProspectoEn solo se escribe la primera vez, mismo patrón
  // que intencionPrecioEn más abajo — usado por el bloque de KPIs de
  // gestión diaria del panel de vendedores (ver GET /demos/kpis-diarios).
  if (esPrimerMensajeProspecto) {
    datosActualizacion.primerMensajeProspectoEn = new Date();
  }

  // intencionPrecioEn solo se escribe la primera vez — no reiniciamos el
  // timer del seguimiento si pregunta por precio varias veces.
  if (detectoIntencionPrecioEsteTurno && !demoAsignada.intencionPrecioEn) {
    datosActualizacion.intencionPrecioDetectada = true;
    datosActualizacion.intencionPrecioEn = new Date();
  }

  // Si esta demo ya fue derivada a vendedor (ya tiene un Lead en el pool,
  // tomado o no), el prospecto puede seguir escribiendo por WhatsApp — el
  // resumen/última interacción del Lead no es un snapshot de una sola vez,
  // tiene que reflejar la conversación más reciente (ver leadSync.js). No se
  // pasa motivoDerivacion acá: eso no cambia por seguir conversando.
  //
  // Se intenta ANTES del update principal de DemoAsignada (no después) para
  // poder fusionar el resultado — éxito o error — en esa misma escritura,
  // sin una consulta/escritura extra. errorSincronizacionLead es un rastro
  // consultable después (a diferencia de un simple console.error): solo
  // tiene contenido cuando refleja un problema vigente, se limpia apenas una
  // sincronización posterior tiene éxito.
  const camposErrorLead = {};
  if (demoAsignada.derivadoAVendedor) {
    try {
      await sincronizarLeadDesdeDemo({
        id: demoAsignada.id,
        telefono: demoAsignada.telefono,
        nombreProspecto: demoAsignada.nombreProspecto,
        intencionPrecioDetectada: datosActualizacion.intencionPrecioDetectada ?? demoAsignada.intencionPrecioDetectada,
        historialSimulacion: datosActualizacion.historialSimulacion,
        ultimaInteraccionEn: datosActualizacion.ultimaInteraccionEn,
      });
      if (demoAsignada.errorSincronizacionLead) {
        camposErrorLead.errorSincronizacionLead = null;
        camposErrorLead.errorSincronizacionLeadEn = null;
      }
    } catch (error) {
      console.error(`[DEMO] Error sincronizando Lead tras nueva interacción (demo ${demoAsignada.id}):`, error.message);
      camposErrorLead.errorSincronizacionLead = error.message;
      camposErrorLead.errorSincronizacionLeadEn = new Date();
    }
  }

  await prisma.demoAsignada.update({
    where: { id: demoAsignada.id },
    data: { ...datosActualizacion, ...camposErrorLead },
  });

  return { respuestaTexto, interactivo };
}

module.exports = { procesarMensajeDemo };
