const prisma = require('../lib/prisma');
const {
  generarRespuestaChatbot,
  redactarMensajePaso,
  formatearConfirmacionCita,
  armarRespuestaHorarios,
  armarRespuestaProximosDias,
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
    }
  }

  // 4. Si el interceptor no aplicó (no coincidió la frase, o la empresa no
  // tiene servicios reales todavía), seguimos el flujo normal con Claude.
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
    update: { mensajes: mensajesActualizados, clienteId: cliente.id, ...datosPausa },
    create: {
      empresaId: empresa.id,
      clienteId: cliente.id,
      telefono: telefonoCliente,
      canal,
      mensajes: mensajesActualizados,
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
  return '(tocó una opción de una lista).';
}

/**
 * Procesa un tap determinístico (día, hora, servicio, o "Otro / no lo
 * encuentro" en la lista de servicios) -- mismo contrato de retorno que
 * procesarMensajeEntrante ({respuestaTexto, interactivo, cliente}), mismo
 * mutex por conversación.
 *
 * @param {Object} params
 * @param {Object} params.empresa
 * @param {string} params.telefonoCliente
 * @param {string|null} params.nombreContacto
 * @param {string} [params.canal]
 * @param {'dia'|'hora'|'servicio'|'servicio_otro'} params.tipoSeleccion
 * @param {Object} params.valorDecodificado - 'dia': {fecha}. 'hora': {fecha, hora}. 'servicio': {servicioId, servicioNombre}. 'servicio_otro': {}.
 */
async function procesarSeleccionInteractiva({ empresa, telefonoCliente, nombreContacto, canal = 'whatsapp', tipoSeleccion, valorDecodificado }) {
  const claveLock = `${empresa.id}:${telefonoCliente}:${canal}`;
  return conLockDeConversacion(claveLock, () =>
    procesarSeleccionInteractivaSinLock({ empresa, telefonoCliente, nombreContacto, canal, tipoSeleccion, valorDecodificado })
  );
}

async function procesarSeleccionInteractivaSinLock({ empresa, telefonoCliente, nombreContacto, canal, tipoSeleccion, valorDecodificado }) {
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
  const descripcionTap = descripcionDeTap(tipoSeleccion, valorDecodificado);

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
  } else {
    throw new Error(`procesarSeleccionInteractiva: tipoSeleccion desconocido "${tipoSeleccion}"`);
  }

  if (!escaladoAHumano) {
    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });
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
            opcionesMostradas: dias.map((d) => ({ valor: d.fecha, etiquetas: [d.fecha] })),
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

      if (resultado.exito) {
        respuestaTexto = formatearConfirmacionCita({
          nombre: reservaEnCurso.nombre,
          servicioNombre: resultado.servicioNombre || reservaEnCurso.servicioNombre,
          fechaLegible: resultado.fechaLegible,
          hora: resultado.hora,
          empresa,
        });
        reservaEnCurso = null; // ya se agendó -- no queda ninguna reserva en curso
      } else {
        // Ej. HORARIO_YA_NO_DISPONIBLE (condición de carrera real: alguien
        // más tomó esa hora justo antes) -- se limpia la hora y se vuelve a
        // pedir, nunca se expone el error crudo de la API al cliente.
        reservaEnCurso = { ...reservaEnCurso, hora: null, opcionesMostradas: null };
        const pasoTrasFalla = siguientePaso(reservaEnCurso, contexto);
        respuestaTexto = (await redactarMensajePaso({ empresa, reservaEnCurso, paso: pasoTrasFalla, mensajeEntrante: resultado.error }))
          || PLANTILLAS_DETERMINISTAS[pasoTrasFalla];
      }
    } else {
      // PEDIR_SERVICIO (no debería ocurrir viniendo de un tap de
      // día/hora/servicio, salvo que se haya reseteado el servicio a mitad
      // de flujo), PEDIR_NOMBRE, PEDIR_RUT -- ninguno tiene una lista
      // interactiva propia acá, solo hace falta redactar la pregunta.
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

module.exports = { procesarMensajeEntrante, procesarSeleccionInteractiva };