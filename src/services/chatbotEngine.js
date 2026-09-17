const prisma = require('../lib/prisma');
const {
  generarRespuestaChatbot,
  redactarMensajePaso,
  formatearConfirmacionCita,
  armarRespuestaHorarios,
  armarRespuestaProximosDias,
  extraerRutYTelefono,
} = require('./claude');
const {
  resolverServicioParaHerramientaPorId,
  crearCitaValidada,
  obtenerProximosDiasConDisponibilidad,
  obtenerProximosDiasParaServicio,
  obtenerHorariosDisponiblesPorBloque,
  obtenerHorasDisponiblesPorBloqueParaServicio,
} = require('./disponibilidad');
const { siguientePaso, coincideConOpcionMostrada, PLANTILLAS_DETERMINISTAS, PASOS } = require('./flujoReserva');
const { conLockDeConversacion } = require('../lib/conversacionLock');
const { fechaLegibleDesdeISO } = require('../lib/formatoFechas');

// Frases genéricas que preguntan por la lista de servicios, normalizadas
// (sin tildes, minúsculas, sin signos de puntuación). Si el mensaje del
// cliente calza EXACTO con alguna de estas, respondemos directo con la
// lista real de servicios como botones — sin pasar por Claude — porque
// confiarle esta pregunta al modelo ha resultado en que a veces arma la
// lista mezclando contenido de "informacionAdicional" en vez de usar
// únicamente los Servicio reales (ver systemPrompt en claude.js, que sigue
// reforzando esto para el resto de formulaciones no cubiertas acá).
const FRASES_PREGUNTA_SERVICIOS = new Set([
  'servicios',
  'que servicios',
  'que servicios ofrecen',
  'que servicios tienen',
  'que servicios hacen',
  'cuales son sus servicios',
  'cuales son los servicios',
  'que atienden',
  'que hacen',
  'que ofrecen',
  'que servicios ofrecen ustedes',
]);

function normalizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[¿?¡!.,]/g, '')
    .trim();
}

/**
 * A partir de un `interactivo` que se mostró de verdad (un tool_use real
 * detrás -- consultar_disponibilidad, consultar_proximos_dias_disponibles
 * o mostrar_lista_servicios, nunca texto libre inventado), guarda las
 * MISMAS opcionesMostradas/fecha que guardaría el camino de tap
 * determinístico (ver procesarSeleccionInteractivaSinLock más abajo) --
 * para que un cliente que sigue conversando en prosa, sin tocar nunca un
 * botón, igual pueda completar el agendamiento en un turno siguiente con
 * un match exacto de texto (paso 8, coincideConOpcionMostrada). Necesario
 * desde que agendar_cita deja de ser una tool de Claude (paso 9 del fix
 * estructural): sin esto, el pipeline agéntico completo podría mostrar
 * disponibilidad real pero nunca dejar un rastro que permita agendar.
 *
 * No hace nada (devuelve reservaEnCurso tal cual) si interactivo es null o
 * de un tipo que no representa una lista de agendamiento (ej.
 * catalogo_imagenes).
 */
function conOpcionesDelPipelineAgentico(reservaEnCurso, interactivo) {
  const base = reservaEnCurso || {};
  if (!interactivo) return base;

  // Si el resultado trae un servicio ya resuelto (ej. el cliente lo nombró
  // en el mismo mensaje y Claude llamó directo a consultar_disponibilidad/
  // consultar_proximos_dias_disponibles, sin pasar por
  // mostrar_lista_servicios -- justo lo que el system prompt le pide hacer
  // en ese caso), se siembra también. Bug real encontrado en review
  // 2026-09-17: sin esto, siguientePaso() seguía pidiendo PEDIR_SERVICIO
  // aunque ya se hubiera mostrado una lista de horas/días, y el siguiente
  // match de texto exacto (ej. "10:00") se malinterpretaba como si fuera
  // el nombre del servicio.
  const conServicio = interactivo.servicioId
    ? { ...base, servicioId: interactivo.servicioId, servicioNombre: interactivo.servicioNombre }
    : base;

  if (interactivo.tipo === 'lista_horarios') {
    return { ...conServicio, fecha: interactivo.fecha, opcionesMostradas: interactivo.horas.map((h) => ({ valor: h, etiquetas: [h] })) };
  }
  if (interactivo.tipo === 'horarios_por_bloque') {
    const horas = interactivo.bloques.flatMap((b) => b.horas);
    return { ...conServicio, fecha: interactivo.fecha, opcionesMostradas: horas.map((h) => ({ valor: h, etiquetas: [h] })) };
  }
  if (interactivo.tipo === 'lista_dias') {
    return {
      ...conServicio,
      opcionesMostradas: interactivo.dias.map((d) => ({ valor: d.fecha, etiquetas: [d.fecha, fechaLegibleDesdeISO(d.fecha)] })),
    };
  }
  if (interactivo.tipo === 'lista_servicios') {
    return { ...base, opcionesMostradas: interactivo.servicios.map((s) => ({ valor: s.id, etiquetas: [s.nombre] })) };
  }
  return base;
}

/**
 * Procesa un mensaje entrante de un cliente para una empresa dada:
 * busca/crea el Cliente y la Conversacion, genera la respuesta con Claude
 * (incluyendo posible uso de herramientas de agenda), y guarda el intercambio.
 *
 * No envía nada por WhatsApp — eso lo decide quien llama a esta función.
 *
 * @param {Object} params
 * @param {Object} params.empresa - Empresa completa, con rubroTemplate incluido.
 * @param {string} params.telefonoCliente - Teléfono (WhatsApp) o IGSID del contacto (Instagram).
 * @param {string} params.textoEntrante
 * @param {string|null} params.nombreContacto
 * @param {string} [params.canal] - 'whatsapp' (default) | 'instagram'
 * @returns {Promise<{respuestaTexto: string, interactivo: Object|null, cliente: Object}>}
 */
async function procesarMensajeEntrante({ empresa, telefonoCliente, textoEntrante, nombreContacto, canal = 'whatsapp' }) {
  // Mutex por conversación (ver src/lib/conversacionLock.js): sin esto, 2
  // mensajes del mismo cliente llegando casi al mismo tiempo (ráfaga, no
  // reintento de Meta -- eso lo filtra la idempotencia de webhook ANTES de
  // llegar acá) leerían el mismo historial "stale" y el que termine último
  // pisaría el turno del otro en Conversacion.mensajes.
  const claveLock = `${empresa.id}:${telefonoCliente}:${canal}`;
  return conLockDeConversacion(claveLock, () =>
    procesarMensajeEntranteSinLock({ empresa, telefonoCliente, textoEntrante, nombreContacto, canal })
  );
}

async function procesarMensajeEntranteSinLock({ empresa, telefonoCliente, textoEntrante, nombreContacto, canal }) {
  // 1. Buscar o crear el Cliente por teléfono dentro de esa empresa. Cliente
  // no tiene campo canal propio -- para Instagram este "telefono" guarda el
  // IGSID (ver Conversacion.canal más abajo, donde sí importa distinguir).
  let cliente = await prisma.cliente.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente },
  });

  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: {
        empresaId: empresa.id,
        telefono: telefonoCliente,
        nombre: nombreContacto || 'Sin nombre',
      },
    });
  }

  // 2. Buscar o crear la Conversacion activa con este cliente. canal entra
  // al where para no confundir un teléfono real de WhatsApp con un IGSID de
  // Instagram que coincida por casualidad.
  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente, canal },
  });

  const historialPrevio = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];

  // 2.1. Coexistence: si un humano está interviniendo esta conversación
  // (echo detectado en el webhook, ver server.js), el bot no responde nada
  // — solo persistimos el mensaje del cliente en el historial, igual que
  // siempre, para que el humano (o el bot, cuando se reactive) tenga el
  // contexto completo. Ningún mensaje del cliente reinicia ni cancela la
  // pausa — eso solo lo hace el job de src/jobs/pausaCoexistence.js.
  if (conversacion?.pausadaPorHumanoEn) {
    const mensajesConEsteTurno = [
      ...historialPrevio,
      { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
    ];

    await prisma.conversacion.update({
      where: { id: conversacion.id },
      data: { mensajes: mensajesConEsteTurno, clienteId: cliente.id },
    });

    return { respuestaTexto: null, interactivo: null, cliente };
  }

  let respuestaTexto;
  let interactivo = null;
  // Estado de la reserva en curso -- se va enriqueciendo a lo largo de este
  // turno (interceptor de servicios, o el pipeline agéntico completo más
  // abajo) con las MISMAS opcionesMostradas/fecha que ya guarda el camino
  // de tap, para que un cliente que solo conversa en prosa (sin tocar
  // nunca un botón) igual pueda completar el agendamiento en un turno
  // siguiente con un match exacto de texto (paso 8) -- necesario desde que
  // agendar_cita deja de ser una tool de Claude (paso 9 del fix
  // estructural): el pipeline completo ya no puede agendar por su cuenta,
  // así que cualquier lista que muestre debe dejar el mismo rastro que
  // dejaría un tap.
  let reservaEnCurso = conversacion?.reservaEnCurso || null;

  // 3. Interceptor determinístico: si el mensaje es una pregunta genérica
  // por los servicios y la empresa tiene Servicio reales cargados,
  // respondemos directo con la lista real como botones, sin pasar por
  // Claude en absoluto para este turno.
  const textoNormalizado = normalizarTexto(textoEntrante);
  if (FRASES_PREGUNTA_SERVICIOS.has(textoNormalizado)) {
    const serviciosReales = await prisma.servicio.findMany({
      where: { empresaId: empresa.id, activo: true },
      orderBy: { nombre: 'asc' },
    });

    if (serviciosReales.length > 0) {
      respuestaTexto = 'Estos son nuestros servicios 👇';
      interactivo = {
        tipo: 'lista_servicios',
        servicios: serviciosReales.map((s) => ({ id: s.id, nombre: s.nombre })),
      };
      reservaEnCurso = conOpcionesDelPipelineAgentico(reservaEnCurso, interactivo);
    }
  }

  // 3.5. Fast-path determinístico de texto exacto (paso 8 del fix
  // estructural, ver flujoReserva.js#coincideConOpcionMostrada). Si hay una
  // reserva en curso y el texto del cliente calza con la misma certeza que
  // un tap (match exacto contra una opción ya mostrada, o un clasificador
  // conservador para nombre/confirmación), se resuelve el turno sin pasar
  // por Claude para decidir el flujo -- Claude solo entra si NO hay
  // ninguna certeza clara (bias siempre hacia el pipeline completo).
  if (respuestaTexto === undefined) {
    const resultadoFastPath = await intentarFastPathTexto({ empresa, telefonoCliente, nombreContacto, canal, conversacion, textoEntrante });
    if (resultadoFastPath) {
      return resultadoFastPath;
    }
  }

  // 4. Si nada de lo anterior aplicó, seguimos el flujo normal con Claude.
  let escaladoAHumano = false;
  if (respuestaTexto === undefined) {
    const resultadoClaude = await generarRespuestaChatbot({
      empresa,
      cliente,
      historial: historialPrevio,
      mensajeEntrante: textoEntrante,
    });
    respuestaTexto = resultadoClaude.texto;
    interactivo = resultadoClaude.interactivo;
    escaladoAHumano = !!resultadoClaude.escaladoAHumano;
    reservaEnCurso = conOpcionesDelPipelineAgentico(reservaEnCurso, interactivo);
  }

  // 5. Guardar el intercambio en la Conversacion. Guardamos siempre la
  // versión en texto (incluso cuando se mostró como lista interactiva) para
  // que el siguiente turno de Claude tenga el contexto completo.
  const mensajesActualizados = [
    ...historialPrevio,
    { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
    { rol: 'asistente', contenido: respuestaTexto, timestamp: new Date().toISOString() },
  ];

  // El cliente pidió hablar con una persona (escalar_a_humano) — se pausa
  // la conversación con el mismo mecanismo que ya usa Coexistence/Chats en
  // vivo (pausadaPorHumanoEn, ver jobs/pausaCoexistence.js: manda un
  // mensaje de contención a los 5 min si nadie respondió, y reactiva el
  // bot solo tras 2h de silencio del cliente). Antes de esto, el bot solo
  // "prometía" pasar con un ejecutivo en texto y seguía respondiendo
  // normal en el siguiente mensaje — reportado por Ahorróptica.
  const datosPausa = escaladoAHumano ? { escaladoAHumano: true, pausadaPorHumanoEn: new Date() } : {};

  await prisma.conversacion.upsert({
    where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
    update: { mensajes: mensajesActualizados, clienteId: cliente.id, reservaEnCurso, ...datosPausa },
    create: {
      empresaId: empresa.id,
      clienteId: cliente.id,
      telefono: telefonoCliente,
      canal,
      mensajes: mensajesActualizados,
      reservaEnCurso,
      ...datosPausa,
    },
  });

  return { respuestaTexto, interactivo, cliente };
}

// ============================================================
// TAP DETERMINÍSTICO (fix estructural 2026-09-17, ver
// C:\Users\ruben\.claude\plans\clever-yawning-stearns.md) -- cuando el
// cliente toca un botón de día/hora/servicio en una lista interactiva de
// WhatsApp, el backend YA sabe con certeza matemática qué eligió (lo
// decodificó del id del botón, sin ninguna interpretación de lenguaje
// natural de por medio). Antes, esa certeza se descartaba al convertir el
// tap en texto sintético y pasarlo por el mismo pipeline agéntico que
// cualquier mensaje libre -- causa confirmada de 4 variantes de bug en
// producción (el bot re-pregunta/re-muestra algo que el cliente ya dejó
// resuelto). Acá el tap nunca toca el pipeline agéntico: escribe
// Conversacion.reservaEnCurso directo, y Claude (si hace falta) solo se usa
// en modo "solo redactar" (ver redactarMensajePaso, claude.js).
// ============================================================

/**
 * @param {Object} empresa
 * @returns {Promise<{serviciosReales: Object[], hayAmbiguedadDeServicio: boolean, requiereRut: boolean}>}
 */
async function contextoFlujoReserva(empresa) {
  const serviciosReales = await prisma.servicio.findMany({
    where: { empresaId: empresa.id, activo: true },
    orderBy: { nombre: 'asc' },
  });
  return {
    serviciosReales,
    hayAmbiguedadDeServicio: serviciosReales.length > 1,
    requiereRut: !!empresa.requiereRut,
  };
}

/**
 * Con 0 o 1 Servicio real no hay ninguna ambigüedad que resolver (mismo
 * criterio que claude.js#hayAmbiguedadDeServicio) -- se siembra
 * servicioId/servicioNombre automáticamente la primera vez, para que
 * siguientePaso() nunca pida un servicio que no hace falta confirmar.
 */
function conServicioUnicoSembrado(reservaEnCurso, contexto) {
  if (contexto.hayAmbiguedadDeServicio || reservaEnCurso.servicioId || contexto.serviciosReales.length !== 1) {
    return reservaEnCurso;
  }
  const unico = contexto.serviciosReales[0];
  return { ...reservaEnCurso, servicioId: unico.id, servicioNombre: unico.nombre };
}

function descripcionDeTap(tipoSeleccion, valorDecodificado) {
  if (tipoSeleccion === 'dia') return `Eligió el día ${valorDecodificado.fecha} de la lista.`;
  if (tipoSeleccion === 'hora') return `Eligió la hora ${valorDecodificado.hora} del ${valorDecodificado.fecha} de la lista.`;
  if (tipoSeleccion === 'servicio') return `Eligió el servicio "${valorDecodificado.servicioNombre}" de la lista.`;
  if (tipoSeleccion === 'servicio_otro') return 'Tocó "Otro / no lo encuentro" en la lista de servicios.';
  if (tipoSeleccion === 'nombre') return `Escribió su nombre: "${valorDecodificado.nombre}".`;
  if (tipoSeleccion === 'confirmar') return 'Confirmó los datos de la reserva.';
  if (tipoSeleccion === 'rut') return '(escribió datos de RUT/teléfono en texto libre).';
  return '(tocó una opción de una lista).';
}

/**
 * Procesa un tap determinístico (día, hora, servicio, "Otro / no lo
 * encuentro"), o una selección EQUIVALENTE detectada en texto libre con la
 * misma certeza (nombre, confirmación -- ver intentarFastPathTexto más
 * abajo, paso 8 del fix estructural) -- mismo contrato de retorno que
 * procesarMensajeEntrante ({respuestaTexto, interactivo, cliente}), mismo
 * mutex por conversación.
 *
 * @param {Object} params
 * @param {Object} params.empresa
 * @param {string} params.telefonoCliente
 * @param {string|null} params.nombreContacto
 * @param {string} [params.canal]
 * @param {'dia'|'hora'|'servicio'|'servicio_otro'|'nombre'|'confirmar'} params.tipoSeleccion
 * @param {Object} params.valorDecodificado - 'dia': {fecha}. 'hora': {fecha, hora}. 'servicio': {servicioId, servicioNombre}. 'servicio_otro'/'confirmar': {}. 'nombre': {nombre}.
 * @param {string} [params.textoOriginalCliente] - Si viene de texto libre (no de un tap real), el texto tal cual lo escribió el cliente, para guardarlo en el historial en vez de una descripción sintética.
 */
async function procesarSeleccionInteractiva({ empresa, telefonoCliente, nombreContacto, canal = 'whatsapp', tipoSeleccion, valorDecodificado, textoOriginalCliente }) {
  const claveLock = `${empresa.id}:${telefonoCliente}:${canal}`;
  return conLockDeConversacion(claveLock, () =>
    procesarSeleccionInteractivaSinLock({ empresa, telefonoCliente, nombreContacto, canal, tipoSeleccion, valorDecodificado, textoOriginalCliente })
  );
}

async function procesarSeleccionInteractivaSinLock({ empresa, telefonoCliente, nombreContacto, canal, tipoSeleccion, valorDecodificado, textoOriginalCliente }) {
  let cliente = await prisma.cliente.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente },
  });
  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: { empresaId: empresa.id, telefono: telefonoCliente, nombre: nombreContacto || 'Sin nombre' },
    });
  }

  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: empresa.id, telefono: telefonoCliente, canal },
  });
  const historialPrevio = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];
  const descripcionTap = textoOriginalCliente || descripcionDeTap(tipoSeleccion, valorDecodificado);

  // Coexistence: igual que procesarMensajeEntranteSinLock, si hay un
  // humano interviniendo, el tap solo se registra en el historial (para
  // contexto) y no se responde nada.
  if (conversacion?.pausadaPorHumanoEn) {
    await prisma.conversacion.update({
      where: { id: conversacion.id },
      data: {
        mensajes: [...historialPrevio, { rol: 'usuario', contenido: descripcionTap, timestamp: new Date().toISOString() }],
        clienteId: cliente.id,
      },
    });
    return { respuestaTexto: null, interactivo: null, cliente };
  }

  const contexto = await contextoFlujoReserva(empresa);
  let reservaEnCurso = conServicioUnicoSembrado({ ...(conversacion?.reservaEnCurso || {}) }, contexto);
  let interactivo = null;
  let respuestaTexto;
  let escaladoAHumano = false;

  if (tipoSeleccion === 'servicio_otro') {
    escaladoAHumano = true;
    respuestaTexto = '¡Dale! En un momento te contactamos directamente 🙌';
  } else if (tipoSeleccion === 'servicio') {
    // Tap duplicado (mismo servicio ya elegido): idempotente, no se
    // reescribe nada ni se vuelve a mostrar la lista de días.
    if (reservaEnCurso.servicioId !== valorDecodificado.servicioId) {
      reservaEnCurso = {
        ...reservaEnCurso,
        servicioId: valorDecodificado.servicioId,
        servicioNombre: valorDecodificado.servicioNombre,
        opcionesMostradas: null,
      };
    }
  } else if (tipoSeleccion === 'dia') {
    if (reservaEnCurso.fecha !== valorDecodificado.fecha) {
      reservaEnCurso = { ...reservaEnCurso, fecha: valorDecodificado.fecha, hora: null, opcionesMostradas: null };
    }
  } else if (tipoSeleccion === 'hora') {
    if (reservaEnCurso.fecha !== valorDecodificado.fecha || reservaEnCurso.hora !== valorDecodificado.hora) {
      reservaEnCurso = { ...reservaEnCurso, fecha: valorDecodificado.fecha, hora: valorDecodificado.hora, opcionesMostradas: null };
    }
  } else if (tipoSeleccion === 'nombre') {
    // Viene del fast-path de texto (paso 8, ver intentarFastPathTexto) --
    // nunca de un tap real, pero comparte el mismo camino determinístico
    // para no duplicar la lógica de "avanzar según el paso" de más abajo.
    if (reservaEnCurso.nombre !== valorDecodificado.nombre) {
      reservaEnCurso = { ...reservaEnCurso, nombre: valorDecodificado.nombre };
    }
  } else if (tipoSeleccion === 'confirmar' || tipoSeleccion === 'rut') {
    // Ambos vienen de texto libre, no de un tap real -- no cambian ningún
    // campo acá mismo, solo disparan la evaluación de siguientePaso de más
    // abajo. 'confirmar' solo se dispara en paso CONFIRMAR (ver
    // intentarFastPathTexto); 'rut' entra siempre que el paso sea
    // PEDIR_RUT, y es la rama de abajo (paso === PASOS.PEDIR_RUT &&
    // textoOriginalCliente) la que hace la extracción real vía Claude.
  } else {
    throw new Error(`procesarSeleccionInteractiva: tipoSeleccion desconocido "${tipoSeleccion}"`);
  }

  if (!escaladoAHumano) {
    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });

    // Compartido entre el paso CONFIRMAR normal y el paso PEDIR_RUT cuando
    // la extracción de RUT+teléfono completa la reserva en el mismo turno
    // -- una sola implementación de "crear la cita real y redactar la
    // confirmación", nunca 2 copias que se puedan desincronizar. Devuelve
    // el texto de confirmación si tuvo éxito (y deja reservaEnCurso en
    // null), o null si falló (el caller decide cómo seguir).
    const confirmarYCrearCita = async () => {
      const nombreParaConfirmacion = reservaEnCurso.nombre;
      const servicioNombreParaConfirmacion = reservaEnCurso.servicioNombre;
      const resultado = await crearCitaValidada(
        {
          servicioId: reservaEnCurso.servicioId || null,
          servicioNombre: reservaEnCurso.servicioNombre || null,
          fecha: reservaEnCurso.fecha,
          hora: reservaEnCurso.hora,
          nombre: reservaEnCurso.nombre,
          rut: reservaEnCurso.rut,
          telefono: reservaEnCurso.telefonoContacto,
        },
        { empresa, cliente, recurso }
      );

      if (!resultado.exito) return { texto: null, error: resultado.error };

      reservaEnCurso = null; // ya se agendó -- no queda ninguna reserva en curso
      return {
        texto: formatearConfirmacionCita({
          nombre: nombreParaConfirmacion,
          servicioNombre: resultado.servicioNombre || servicioNombreParaConfirmacion,
          fechaLegible: resultado.fechaLegible,
          hora: resultado.hora,
          empresa,
        }),
        error: null,
      };
    };

    const paso = siguientePaso(reservaEnCurso, contexto);

    if (paso === PASOS.PEDIR_DIA) {
      // El cliente ya sabe el servicio (tap de servicio, o negocio sin
      // ambigüedad) -- mostrar los próximos días con cupo real, igual que
      // hacía consultar_proximos_dias_disponibles.
      const resuelto = reservaEnCurso.servicioId
        ? await resolverServicioParaHerramientaPorId(empresa, recurso, reservaEnCurso.servicioId)
        : { usaProfesionalFijo: true, recursoId: recurso?.id || null, servicioDb: null };

      if (resuelto.usaProfesionalFijo && !resuelto.recursoId) {
        respuestaTexto = 'Todavía no tenemos un profesional configurado para agendar -- te contactamos directamente.';
        escaladoAHumano = true;
      } else {
        const dias = resuelto.usaProfesionalFijo
          ? await obtenerProximosDiasConDisponibilidad(resuelto.recursoId, 7)
          : await obtenerProximosDiasParaServicio(resuelto.servicioDb.id, 7);

        if (dias.length === 0) {
          respuestaTexto = 'No encontramos cupo disponible en los próximos días -- te contactamos directamente para coordinar.';
          escaladoAHumano = true;
        } else {
          const armada = armarRespuestaProximosDias(dias);
          respuestaTexto = armada.texto;
          interactivo = armada.interactivo;
          reservaEnCurso = {
            ...reservaEnCurso,
            // etiquetas incluye AMBAS formas -- el ISO crudo y la fecha
            // legible en español (que es lo que el cliente realmente ve
            // en la fila de la lista de WhatsApp, ver server.js -- un
            // cliente que retipea exactamente lo que vio debe calzar).
            opcionesMostradas: dias.map((d) => ({ valor: d.fecha, etiquetas: [d.fecha, fechaLegibleDesdeISO(d.fecha)] })),
          };
        }
      }
    } else if (paso === PASOS.PEDIR_HORA) {
      // Día ya elegido (tap, o texto exacto -- paso 8) -- mostrar las horas
      // reales de ESE día, igual que hacía consultar_disponibilidad.
      const resuelto = reservaEnCurso.servicioId
        ? await resolverServicioParaHerramientaPorId(empresa, recurso, reservaEnCurso.servicioId)
        : { usaProfesionalFijo: true, recursoId: recurso?.id || null, servicioDb: null };

      if (resuelto.usaProfesionalFijo && !resuelto.recursoId) {
        respuestaTexto = 'Todavía no tenemos un profesional configurado para agendar -- te contactamos directamente.';
        escaladoAHumano = true;
      } else {
        const bloques = resuelto.usaProfesionalFijo
          ? await obtenerHorariosDisponiblesPorBloque(resuelto.recursoId, reservaEnCurso.fecha)
          : await obtenerHorasDisponiblesPorBloqueParaServicio(resuelto.servicioDb.id, reservaEnCurso.fecha);
        const horas = bloques.flatMap((b) => b.horas);

        if (horas.length === 0) {
          // El día que se acaba de elegir ya no tiene cupo (se llenó justo
          // ahora) -- se limpia la fecha para no dejar la reserva en un
          // estado inconsistente, y se vuelve a pedir día.
          reservaEnCurso = { ...reservaEnCurso, fecha: null, opcionesMostradas: null };
          respuestaTexto = 'Ese día ya no tiene cupo disponible, ¿quieres que te muestre otro?';
        } else {
          const armada = armarRespuestaHorarios(reservaEnCurso.fecha, horas, bloques);
          respuestaTexto = armada.texto;
          interactivo = armada.interactivo;
          reservaEnCurso = {
            ...reservaEnCurso,
            opcionesMostradas: horas.map((h) => ({ valor: h, etiquetas: [h] })),
          };
        }
      }
    } else if (paso === PASOS.CONFIRMAR) {
      const resultadoConfirmar = await confirmarYCrearCita();
      if (resultadoConfirmar.texto) {
        respuestaTexto = resultadoConfirmar.texto;
      } else {
        // Ej. HORARIO_YA_NO_DISPONIBLE (condición de carrera real: alguien
        // más tomó esa hora justo antes) -- se limpia la hora y se vuelve a
        // pedir, nunca se expone el error crudo de la API al cliente.
        reservaEnCurso = { ...reservaEnCurso, hora: null, opcionesMostradas: null };
        const pasoTrasFalla = siguientePaso(reservaEnCurso, contexto);
        respuestaTexto = (await redactarMensajePaso({ empresa, reservaEnCurso, paso: pasoTrasFalla, mensajeEntrante: resultadoConfirmar.error }))
          || PLANTILLAS_DETERMINISTAS[pasoTrasFalla];
      }
    } else if (paso === PASOS.PEDIR_RUT && textoOriginalCliente) {
      // RUT/teléfono deliberadamente NO tienen fast-path por regex (paso
      // 8): un mensaje corto rara vez trae ambos datos de forma
      // inequívoca. En vez de eso, se usa Claude con UNA sola herramienta
      // acotada (extraerRutYTelefono, claude.js) que SOLO puede extraer
      // esos 2 campos del texto -- nunca decide el flujo, nunca agenda,
      // nunca llama a ninguna otra herramienta. Si el negocio no exige
      // RUT, este paso nunca se alcanza (siguientePaso lo salta).
      const extraido = await extraerRutYTelefono({ empresa, reservaEnCurso, mensajeEntrante: textoOriginalCliente });

      if (extraido.texto) {
        // Claude no encontró ninguno de los 2 datos en este mensaje (ej.
        // el cliente preguntó algo, o dijo que no tiene el RUT a mano) --
        // se usa su respuesta puntual tal cual, sin avanzar nada.
        respuestaTexto = extraido.texto;
      } else {
        if (extraido.rut && reservaEnCurso.rut !== extraido.rut) {
          reservaEnCurso = { ...reservaEnCurso, rut: extraido.rut };
        }
        if (extraido.telefono && reservaEnCurso.telefonoContacto !== extraido.telefono) {
          reservaEnCurso = { ...reservaEnCurso, telefonoContacto: extraido.telefono };
        }
        const pasoTrasExtraccion = siguientePaso(reservaEnCurso, contexto);
        if (pasoTrasExtraccion === PASOS.CONFIRMAR) {
          const resultadoConfirmar = await confirmarYCrearCita();
          if (resultadoConfirmar.texto) {
            respuestaTexto = resultadoConfirmar.texto;
          } else {
            reservaEnCurso = { ...reservaEnCurso, hora: null, opcionesMostradas: null };
            const pasoTrasFalla = siguientePaso(reservaEnCurso, contexto);
            respuestaTexto = (await redactarMensajePaso({ empresa, reservaEnCurso, paso: pasoTrasFalla, mensajeEntrante: resultadoConfirmar.error }))
              || PLANTILLAS_DETERMINISTAS[pasoTrasFalla];
          }
        } else {
          // Faltó uno de los 2 datos (ej. dio el RUT pero no el teléfono),
          // o el RUT que mencionó no es válido -- en ese segundo caso se le
          // pasa el detalle a redactarMensajePaso para que dé feedback
          // específico (ej. "12.345 no parece un RUT chileno válido"), en
          // vez del genérico "pídelo de nuevo" -- mismo cuidado que tenía
          // el bloque original de agendar_cita antes de este refactor.
          const pistaError = extraido.rutInvalido
            ? `El cliente escribió "${extraido.rutInvalido}" como RUT, pero no tiene formato de RUT chileno válido (ej. 12345678-9). Pídeselo de nuevo.`
            : null;
          respuestaTexto = (await redactarMensajePaso({ empresa, reservaEnCurso, paso: pasoTrasExtraccion, mensajeEntrante: pistaError }))
            || PLANTILLAS_DETERMINISTAS[pasoTrasExtraccion];
        }
      }
    } else {
      // PEDIR_SERVICIO (no debería ocurrir viniendo de un tap de
      // día/hora/servicio, salvo que se haya reseteado el servicio a mitad
      // de flujo), PEDIR_NOMBRE, o PEDIR_RUT llegado por un TAP (sin texto
      // que extraer) -- ninguno tiene una lista interactiva propia acá,
      // solo hace falta redactar la pregunta.
      respuestaTexto = (await redactarMensajePaso({ empresa, reservaEnCurso, paso, mensajeEntrante: null }))
        || PLANTILLAS_DETERMINISTAS[paso];
    }
  }

  const mensajesActualizados = [
    ...historialPrevio,
    { rol: 'usuario', contenido: descripcionTap, timestamp: new Date().toISOString() },
    { rol: 'asistente', contenido: respuestaTexto, timestamp: new Date().toISOString() },
  ];

  const datosPausa = escaladoAHumano ? { escaladoAHumano: true, pausadaPorHumanoEn: new Date() } : {};

  await prisma.conversacion.upsert({
    where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
    update: { mensajes: mensajesActualizados, clienteId: cliente.id, reservaEnCurso, ...datosPausa },
    create: {
      empresaId: empresa.id,
      clienteId: cliente.id,
      telefono: telefonoCliente,
      canal,
      mensajes: mensajesActualizados,
      reservaEnCurso,
      ...datosPausa,
    },
  });

  return { respuestaTexto, interactivo, cliente };
}

// ============================================================
// FAST-PATH DE TEXTO EXACTO (paso 8 del fix estructural) -- cuando el
// cliente escribe en vez de tocar, pero su texto calza con la MISMA
// certeza que un tap (match exacto contra una opción ya mostrada, o un
// clasificador conservador para nombre/confirmación), se resuelve el turno
// exactamente igual que un tap, sin pasar por el pipeline agéntico para
// decidir el flujo. Bias siempre hacia el pipeline completo cuando hay
// cualquier duda -- nunca se "adivina".
// ============================================================

// Comandos globales y preguntas SIEMPRE van al pipeline completo, sin
// excepción, en cualquier paso -- nunca se interceptan acá, para no
// arriesgar interpretar mal un "cancela mi hora", "hablar con alguien" o
// una pregunta genuina (incluso sin "?", ej. "puedo ir más temprano") como
// si fuera una confirmación de dato.
const REGEX_COMANDO_GLOBAL = /\b(cancela|cancelar|anula|anular|reagenda|reagendar|reprograma|reprogramar)\b.{0,20}\b(cita|hora|reserva)\b|\bhablar\s+con\s+(un|una)?\s*(persona|humano|ejecutivo|agente|alguien)\b/i;
// Aperturas típicas de pregunta que NO siempre están al inicio del mensaje
// ni llevan "?" (frecuente en WhatsApp) -- revisadas 2026-09-17 tras
// encontrar en review que "puedo ir más temprano" se colaba sin marca de
// pregunta y sin ninguna de las PALABRAS_INTERROGATIVAS clásicas.
const REGEX_PATRON_PREGUNTA = /\b(puedo|podr[ií]a|podr[ií]as|puede|pueden|debo|se puede|me puedes|me pueden|quiero saber|necesito saber|sabes|sabe|cu[aá]nto (cuesta|sale|vale|es)|hay (disponibilidad|hora|cupo))\b/i;
const PALABRAS_INTERROGATIVAS = ['que', 'como', 'cuando', 'donde', 'cual', 'cuales', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'quien', 'quienes', 'porque'];

function esComandoGlobalOPregunta(texto) {
  const t = (texto || '').trim();
  if (!t) return false;
  if (/[?¿]/.test(t)) return true;
  if (REGEX_COMANDO_GLOBAL.test(t)) return true;
  if (REGEX_PATRON_PREGUNTA.test(t)) return true;
  const normalizado = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '');
  // Revisa CUALQUIER palabra del mensaje, no solo la primera (un mensaje
  // real de WhatsApp rara vez abre con la palabra interrogativa, ej. "y
  // por qué tan tarde" o "ya pero cuánto cuesta").
  return normalizado.split(/\s+/).some((p) => PALABRAS_INTERROGATIVAS.includes(p));
}

// Frases cortas frecuentes que tienen la FORMA de "2+ palabras de solo
// letras" pero nunca son un nombre -- encontradas en review 2026-09-17
// ("no se", "hola buenas" pasaban el chequeo de forma sin este filtro).
// Comparación por texto normalizado completo (no por palabra suelta), para
// no bloquear nombres reales que casualmente contengan alguna de estas
// palabras.
const FRASES_NO_SON_NOMBRE = new Set([
  'no se', 'nose', 'no lo se', 'no se aun', 'no se todavia',
  'hola', 'hola buenas', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola buenos dias',
  'gracias', 'muchas gracias', 'ok gracias',
  'no gracias', 'no puedo', 'no puedo ir', 'lo mismo', 'me da lo mismo', 'da lo mismo',
  'cualquiera', 'cualquier hora', 'no importa', 'esta bien', 'de acuerdo',
]);

// Clasificador conservador de "esto parece un nombre de persona" -- 2 a 5
// palabras, solo letras (con tildes/ñ), sin dígitos, sin signos de
// pregunta, ninguna frase conocida de la lista de arriba. Cualquier cosa
// que no calce claramente cae al pipeline completo (nunca se fuerza una
// interpretación dudosa) -- el caller ya filtró comandos/preguntas antes
// de llegar acá (ver esComandoGlobalOPregunta), esto es una segunda capa.
function pareceNombre(texto) {
  const t = (texto || '').trim();
  if (!t || t.length > 60) return false;
  if (/[¿?\d]/.test(t)) return false;
  if (FRASES_NO_SON_NOMBRE.has(normalizarTexto(t))) return false;
  const palabras = t.split(/\s+/);
  if (palabras.length < 2 || palabras.length > 5) return false;
  return palabras.every((p) => /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü'.-]{2,}$/.test(p));
}

// Mismo patrón que el bloque de confirmación de citas PENDIENTES de
// server.js (respuesta corta a un recordatorio) -- reusado acá para el
// paso CONFIRMAR de una reserva EN CURSO (dato distinto, mismo criterio de
// "afirmación corta e inequívoca").
const REGEX_AFIRMACION_RESERVA = /^\s*(s[ií]|confirmo|confirmar|dale|ok|listo|correcto|de acuerdo|as[ií] es)\s*[.!]?\s*$/i;

/**
 * Intenta resolver el turno actual con certeza de tap a partir de texto
 * libre. Devuelve el mismo shape que procesarMensajeEntrante/
 * procesarSeleccionInteractiva ({respuestaTexto, interactivo, cliente}) si
 * pudo resolverlo, o null si no hay ninguna certeza clara -- en ese caso el
 * caller (procesarMensajeEntranteSinLock) sigue al flujo de siempre.
 *
 * PEDIR_SERVICIO se cubre igual que PEDIR_DIA/PEDIR_HORA (match exacto
 * contra opcionesMostradas) -- complementa, sin reemplazar, la red de
 * seguridad ya existente en claude.js (mensajeNombraServicioExactoSinDia)
 * para el caso en que el pipeline agéntico completo mostró la lista real
 * (ver conOpcionesDelPipelineAgentico). Si no hay opcionesMostradas
 * todavía (nunca se mostró ninguna lista), sigue al pipeline completo como
 * siempre -- nunca se adivina un servicio sin haberlo mostrado antes.
 * PEDIR_RUT no tiene un clasificador de FORMA acá (un mensaje corto rara
 * vez trae RUT + teléfono de forma inequívoca por regex), pero SÍ se cubre
 * más abajo -- delegado a extraerRutYTelefono (claude.js), una extracción
 * acotada con Claude que nunca decide el flujo, solo esos 2 campos
 * puntuales (necesario desde que agendar_cita deja de ser una tool de
 * Claude, ver paso 9 del fix estructural).
 */
async function intentarFastPathTexto({ empresa, telefonoCliente, nombreContacto, canal, conversacion, textoEntrante }) {
  if (esComandoGlobalOPregunta(textoEntrante)) return null;

  const contexto = await contextoFlujoReserva(empresa);
  const reservaCruda = conversacion?.reservaEnCurso || {};
  // "¿Hay algo en progreso?" se revisa ANTES de sembrar el servicio único
  // -- conServicioUnicoSembrado agrega servicioId incluso a una reserva
  // vacía cuando el negocio no tiene ambigüedad real (ej. Ahorróptica, 1
  // solo servicio), lo que rompía este chequeo por conteo de claves
  // (encontrado en review 2026-09-17): una conversación recién empezada
  // para ese tipo de negocio nunca contaba como "vacía". Ahora se revisan
  // solo los campos que reflejan progreso REAL del cliente.
  const hayRervaEnProgreso = !!(
    reservaCruda.fecha || reservaCruda.hora || reservaCruda.nombre || reservaCruda.rut || reservaCruda.telefonoContacto ||
    (contexto.hayAmbiguedadDeServicio && reservaCruda.servicioId) ||
    // opcionesMostradas por sí solo también cuenta como "en progreso" --
    // ej. el pipeline agéntico completo mostró la lista de servicios pero
    // el cliente todavía no eligió nada más (ver
    // conOpcionesDelPipelineAgentico, paso 9 del fix estructural).
    (Array.isArray(reservaCruda.opcionesMostradas) && reservaCruda.opcionesMostradas.length > 0)
  );
  if (!hayRervaEnProgreso) return null; // nada en progreso -- pipeline completo, como siempre

  const reservaEnCurso = conServicioUnicoSembrado({ ...reservaCruda }, contexto);

  const paso = siguientePaso(reservaEnCurso, contexto);
  const base = { empresa, telefonoCliente, nombreContacto, canal, textoOriginalCliente: textoEntrante };

  if (paso === PASOS.PEDIR_SERVICIO) {
    const servicioIdCoincidente = coincideConOpcionMostrada(textoEntrante, reservaEnCurso.opcionesMostradas);
    if (!servicioIdCoincidente) return null;
    // Guardia defensiva (agregada en review 2026-09-17): opcionesMostradas
    // puede, en teoría, venir de una lista que NO era de servicios (ej. un
    // resto de una lista de horas/días vieja) -- coincideConOpcionMostrada
    // no sabe distinguir tipos, solo compara texto. Verificar contra los
    // Servicio reales de la empresa antes de aceptar el match evita
    // escribir un servicioId inventado en reservaEnCurso.
    const esServicioReal = contexto.serviciosReales.some((s) => s.id === servicioIdCoincidente);
    if (!esServicioReal) return null;
    const opcion = (reservaEnCurso.opcionesMostradas || []).find((o) => o.valor === servicioIdCoincidente);
    const servicioNombreCoincidente = opcion?.etiquetas?.[0];
    if (!servicioNombreCoincidente) return null; // defensivo, no debería pasar
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'servicio', valorDecodificado: { servicioId: servicioIdCoincidente, servicioNombre: servicioNombreCoincidente } });
  }

  if (paso === PASOS.PEDIR_DIA) {
    const fechaCoincidente = coincideConOpcionMostrada(textoEntrante, reservaEnCurso.opcionesMostradas);
    if (!fechaCoincidente) return null;
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'dia', valorDecodificado: { fecha: fechaCoincidente } });
  }

  if (paso === PASOS.PEDIR_HORA) {
    const horaCoincidente = coincideConOpcionMostrada(textoEntrante, reservaEnCurso.opcionesMostradas);
    if (!horaCoincidente) return null;
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'hora', valorDecodificado: { fecha: reservaEnCurso.fecha, hora: horaCoincidente } });
  }

  if (paso === PASOS.PEDIR_NOMBRE) {
    if (!pareceNombre(textoEntrante)) return null;
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'nombre', valorDecodificado: { nombre: textoEntrante.trim() } });
  }

  if (paso === PASOS.CONFIRMAR) {
    if (!REGEX_AFIRMACION_RESERVA.test(textoEntrante || '')) return null;
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'confirmar', valorDecodificado: {} });
  }

  if (paso === PASOS.PEDIR_RUT) {
    // Sin clasificador de forma acá (RUT+teléfono rara vez llegan
    // inequívocos en un mensaje corto) -- se delega la extracción a Claude
    // con una sola herramienta acotada (extraerRutYTelefono, claude.js),
    // nunca a una decisión de flujo. Incondicional: es la propia
    // herramienta la que decide si encontró algo o no.
    return procesarSeleccionInteractivaSinLock({ ...base, tipoSeleccion: 'rut', valorDecodificado: {} });
  }

  return null;
}

module.exports = { procesarMensajeEntrante, procesarSeleccionInteractiva };