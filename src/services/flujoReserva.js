// Lógica PURA del flujo de agendamiento — sin DB, sin llamadas a Claude, sin
// efectos secundarios. Deriva "en qué paso va esta reserva" a partir de qué
// campos de reservaEnCurso ya están llenos (Conversacion.reservaEnCurso, ver
// schema.prisma), en vez de un enum de estado persistido: agregar/quitar un
// paso es solo mover un `if`, no migrar datos existentes.
//
// Parte del fix estructural 2026-09-17 (el bot pierde certeza al convertir
// taps en texto libre → vuelve a pedir/mostrar algo que el cliente ya dejó
// resuelto). El backend escribe reservaEnCurso con certeza matemática (tap
// decodificado, o texto libre que calza EXACTO con una opción ya mostrada —
// ver coincideConOpcionMostrada) y Claude solo lo recibe como HECHO, nunca
// tiene que re-derivarlo del historial en texto plano.

const PASOS = Object.freeze({
  PEDIR_SERVICIO: 'PEDIR_SERVICIO',
  PEDIR_DIA: 'PEDIR_DIA',
  PEDIR_HORA: 'PEDIR_HORA',
  PEDIR_NOMBRE: 'PEDIR_NOMBRE',
  PEDIR_RUT: 'PEDIR_RUT',
  CONFIRMAR: 'CONFIRMAR',
});

/**
 * Deriva el paso actual del flujo de agendamiento.
 *
 * @param {Object|null} reservaEnCurso - Conversacion.reservaEnCurso tal cual está guardado.
 * @param {Object} contexto
 * @param {boolean} contexto.hayAmbiguedadDeServicio - true si el negocio tiene 2+ Servicio reales (mismo criterio que claude.js). Con 0 o 1, no hay nada que preguntar — el paso PEDIR_SERVICIO nunca aparece.
 * @param {boolean} contexto.requiereRut - Empresa.requiereRut.
 * @returns {string} Una de las claves de PASOS.
 */
// Horas de inactividad tras las que una reservaEnCurso a medio hacer se
// considera abandonada, en vez de "seguir en progreso" indefinidamente.
// Bug real confirmado 2026-09-22/23 (Diego, Ahorróptica): una reserva
// iniciada el 18-sep y nunca terminada (dejó de responder al pedirle
// RUT+teléfono) seguía "viva" 4 días después -- cualquier mensaje corto
// posterior (incluida una respuesta "Sí" a un recordatorio de OTRA cita)
// se metía a completar esa reserva vieja en vez de tratarse como algo
// nuevo, produciendo respuestas sin sentido ("¿prefieres que intentemos
// agendar de nuevo?", pedir la hora de una fecha ya vieja, etc.).
const HORAS_MAX_INACTIVIDAD_RESERVA = 3;

/**
 * true si el último mensaje real de la conversación (antes de este turno)
 * es más viejo que HORAS_MAX_INACTIVIDAD_RESERVA -- señal de que cualquier
 * reservaEnCurso pendiente quedó abandonada, no que el cliente sigue en el
 * mismo trámite.
 *
 * @param {Array} historialPrevio - Conversacion.mensajes tal cual está guardado (antes de agregar el turno actual).
 * @param {Date} [ahora] - inyectable para pruebas.
 */
function reservaAbandonada(historialPrevio, ahora = new Date()) {
  if (!Array.isArray(historialPrevio) || historialPrevio.length === 0) return false;
  const ultimoTimestamp = historialPrevio[historialPrevio.length - 1]?.timestamp;
  if (!ultimoTimestamp) return false;
  const horasTranscurridas = (ahora - new Date(ultimoTimestamp)) / (1000 * 60 * 60);
  return horasTranscurridas > HORAS_MAX_INACTIVIDAD_RESERVA;
}

function siguientePaso(reservaEnCurso, contexto) {
  const r = reservaEnCurso || {};
  const { hayAmbiguedadDeServicio, requiereRut } = contexto || {};

  if (hayAmbiguedadDeServicio && !r.servicioId) return PASOS.PEDIR_SERVICIO;
  if (!r.fecha) return PASOS.PEDIR_DIA;
  if (!r.hora) return PASOS.PEDIR_HORA;
  if (!r.nombre) return PASOS.PEDIR_NOMBRE;
  if (requiereRut && (!r.rut || !r.telefonoContacto)) return PASOS.PEDIR_RUT;
  return PASOS.CONFIRMAR;
}

function normalizarTextoPlano(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .trim();
}

/**
 * Compara texto libre contra el último set cerrado de opciones que el
 * backend mostró (reservaEnCurso.opcionesMostradas). Si calza EXACTO
 * (normalizado) con alguna etiqueta, se trata con la misma certeza que un
 * tap — devuelve el `valor` de esa opción. Si no hay match, devuelve null:
 * nunca se adivina, el texto sigue al pipeline agéntico completo.
 *
 * @param {string} textoEntrante
 * @param {Array<{valor: any, etiquetas: string[]}>} opcionesMostradas
 * @returns {*} El `valor` de la opción calzada, o null.
 */
function coincideConOpcionMostrada(textoEntrante, opcionesMostradas) {
  const normalizado = normalizarTextoPlano(textoEntrante);
  if (!normalizado || !Array.isArray(opcionesMostradas)) return null;

  for (const opcion of opcionesMostradas) {
    const etiquetas = Array.isArray(opcion?.etiquetas) ? opcion.etiquetas : [];
    if (etiquetas.some((e) => normalizarTextoPlano(e) === normalizado)) {
      return opcion.valor;
    }
  }
  return null;
}

// Texto fijo por paso, usado SOLO como fallback determinístico cuando el
// pipeline agéntico (redactarMensajePaso, ver claude.js) se agota sin
// devolver texto utilizable — nunca el mensaje genérico de error de antes.
const PLANTILLAS_DETERMINISTAS = Object.freeze({
  [PASOS.PEDIR_SERVICIO]: '¿Para cuál de estos servicios necesitas la hora? 👇',
  [PASOS.PEDIR_DIA]: '¿Qué día te gustaría agendar?',
  [PASOS.PEDIR_HORA]: '¿A qué hora te gustaría agendar?',
  [PASOS.PEDIR_NOMBRE]: '¿Me puedes confirmar el nombre completo de quien se va a atender?',
  [PASOS.PEDIR_RUT]: '¿Me puedes confirmar tu RUT y un teléfono de contacto?',
  [PASOS.CONFIRMAR]: 'Disculpa, tuve un problema procesando tu solicitud — ¿me confirmas de nuevo los datos de tu cita?',
});

module.exports = {
  PASOS,
  siguientePaso,
  normalizarTextoPlano,
  coincideConOpcionMostrada,
  PLANTILLAS_DETERMINISTAS,
  reservaAbandonada,
};
