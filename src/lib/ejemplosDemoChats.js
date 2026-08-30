// Conversaciones de ejemplo mostradas en "Chats en vivo" solo para empresas
// demo (Empresa.esDemo === true) — para que un prospecto viendo su panel de
// demo entienda cómo se ve el panel con varias conversaciones activas, sin
// mezclar contenido inventado con sus propias interacciones reales (esas
// siguen viniendo 100% de la tabla Conversacion, sin tocar).
//
// Los timestamps se calculan siempre en relación a "ahora" (nunca se
// guardan en la BD) — por eso quedan siempre dentro de las últimas 48h sin
// necesidad de ningún job que los limpie o refresque.

const HORAS_ATRAS_POR_EJEMPLO = [3, 18, 40]; // todas < 48h

const EJEMPLOS = [
  {
    id: 'ejemplo-1',
    clienteNombre: 'Cliente ejemplo 1',
    telefonoFalso: '+56 9 5555 0001',
    mensajes: [
      { rol: 'usuario', contenido: 'Hola, ¿tienen hora para mañana en la tarde?' },
      { rol: 'asistente', contenido: '¡Hola! 👋 Sí, tenemos disponibilidad mañana entre las 15:00 y las 18:30. ¿Qué horario te acomoda más?' },
      { rol: 'usuario', contenido: 'A las 16:00 estaría perfecto' },
      { rol: 'asistente', contenido: '¡Listo! Te dejé agendado mañana a las 16:00. Te voy a mandar un recordatorio antes de la hora 🙌' },
    ],
  },
  {
    id: 'ejemplo-2',
    clienteNombre: 'Cliente ejemplo 2',
    telefonoFalso: '+56 9 5555 0002',
    mensajes: [
      { rol: 'usuario', contenido: '¿Cuánto cuesta la consulta?' },
      { rol: 'asistente', contenido: 'La consulta tiene un valor de $25.000. Si necesitas un servicio en particular puedo darte el detalle exacto — ¿qué estás buscando?' },
      { rol: 'usuario', contenido: 'Solo quería saber el valor general, gracias' },
      { rol: 'asistente', contenido: '¡De nada! Cualquier otra duda, aquí estoy 🙌' },
    ],
  },
  {
    id: 'ejemplo-3',
    clienteNombre: 'Cliente ejemplo 3',
    telefonoFalso: '+56 9 5555 0003',
    mensajes: [
      { rol: 'usuario', contenido: '¿Están abiertos los sábados?' },
      { rol: 'asistente', contenido: 'Sí, atendemos los sábados de 10:00 a 14:00. ¿Quieres que te reserve una hora para este sábado?' },
      { rol: 'usuario', contenido: 'Sí porfa, a las 11' },
      { rol: 'asistente', contenido: 'Perfecto, quedaste agendado este sábado a las 11:00 ✅' },
    ],
  },
];

function timestampHaceHoras(horas) {
  return new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
}

function construirMensajesConTimestamps(ejemplo, horasAtras) {
  // Espacia los mensajes del ejemplo dentro de la última hora antes del
  // timestamp base, para que se vean como una conversación real y no todos
  // con el mismo instante exacto.
  const base = Date.now() - horasAtras * 60 * 60 * 1000;
  return ejemplo.mensajes.map((m, i) => ({
    ...m,
    timestamp: new Date(base + i * 60 * 1000).toISOString(),
  }));
}

function listarEjemplosParaResumen() {
  return EJEMPLOS.map((ejemplo, i) => {
    const horasAtras = HORAS_ATRAS_POR_EJEMPLO[i];
    const mensajes = construirMensajesConTimestamps(ejemplo, horasAtras);
    const ultimoMensaje = mensajes[mensajes.length - 1];
    return {
      id: ejemplo.id,
      clienteNombre: ejemplo.clienteNombre,
      telefono: ejemplo.telefonoFalso,
      clienteId: null,
      ultimoMensaje: ultimoMensaje.contenido,
      ultimoMensajeTimestamp: ultimoMensaje.timestamp,
      ultimoMensajeRol: ultimoMensaje.rol,
      totalMensajes: mensajes.length,
      escaladoAHumano: false,
      actualizadoEn: ultimoMensaje.timestamp,
      esEjemplo: true,
    };
  });
}

function obtenerEjemploCompleto(conversacionId) {
  const index = EJEMPLOS.findIndex((e) => e.id === conversacionId);
  if (index === -1) return null;

  const ejemplo = EJEMPLOS[index];
  const mensajes = construirMensajesConTimestamps(ejemplo, HORAS_ATRAS_POR_EJEMPLO[index]);
  return {
    id: ejemplo.id,
    clienteNombre: ejemplo.clienteNombre,
    telefono: ejemplo.telefonoFalso,
    cliente: null,
    escaladoAHumano: false,
    mensajes,
    esEjemplo: true,
  };
}

module.exports = { listarEjemplosParaResumen, obtenerEjemploCompleto };
