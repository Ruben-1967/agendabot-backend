// Detecta mensajes cortos con los que un cliente CONFIRMA QUE ASISTIRÁ a su
// hora ("ok mañana iré", "ahí estaré", "nos vemos", "cuenten conmigo"...),
// típicamente como respuesta a un recordatorio de cita. Caso real
// (Ahorróptica, 2026-10-06): una paciente respondió "Ok mañna iré" a un
// recordatorio y el bot, sin contexto, le preguntó si quería agendar una
// hora. Con esto el bot (server.js) confirma la cita pendiente si hay una, o
// responde un simple "te esperamos" si no, en vez de volver a ofrecer
// agendar.
//
// Es deliberadamente conservador: ante la mínima señal de negación,
// pregunta, cambio de hora o intención de agendar, devuelve false y el
// mensaje sigue al flujo normal (Claude). Trabaja sobre texto normalizado
// (sin tildes, minúsculas, sin signos) para tolerar "iré"/"ire", "ahí"/"ahi"
// y escritura descuidada de WhatsApp.

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1') // "iréeee" -> "iree"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Expresiones de asistencia, sobre texto normalizado. Cada alternativa es una
// palabra/frase completa (límites con \b: el texto ya no tiene tildes).
const REGEX_ASISTENCIA = new RegExp(
  '\\b(' + [
    // ir -- "voy"/"vamos" SOLOS no cuentan ("voy a pensarlo", "vamos viendo"):
    // solo calzan en frases que expresan ir a la cita.
    'ire', 'iree', 'iremos', 'voy a ir', 'vamos a ir', 'voy para alla', 'voy para alli', 'vamos para alla', 'ahi voy', 'alla voy',
    'ahi vamos', 'alla vamos', 'ya voy', 'voy igual', 'voy sin falta', 'voy manana', 'voy a estar', 'vamos a estar',
    // asistir
    'asistire', 'asistiremos', 'asisto', 'asistiendo', 'voy a asistir', 'vamos a asistir', 'asistire sin falta',
    // estar
    'estare', 'estaremos', 'estoy ahi', 'estamos ahi', 'ahi estoy', 'ahi estare', 'ahi estaremos', 'ahi estamos', 'alla estare',
    'alla estaremos', 'alla estoy', 'alla estamos', 'estare ahi', 'estare alla',
    // verse
    'nos vemos', 'nos veremos', 'ahi nos vemos', 'alla nos vemos', 'nos vemos manana', 'nos vemos entonces',
    // llegar / pasar
    'llegare', 'llegaremos', 'llego', 'llegamos', 'alla llego', 'ahi llego', 'ahi llegamos', 'pasare', 'pasaremos', 'paso por alla',
    'paso por ahi', 'me paso', 'paso manana', 'paso en la manana', 'paso en la tarde',
    // confirmar
    'confirmado', 'confirmada', 'confirmo', 'confirmamos', 'queda confirmado', 'queda confirmada', 'asistencia confirmada',
    // disposición
    'cuenten conmigo', 'cuenta conmigo', 'cuenten con nosotros', 'cuenta con nosotros', 'espereme', 'esperenme', 'me esperan',
    'nos esperan',
  ].join('|') + ')\\b'
);

// Cualquiera de estas anula la detección: negación, pregunta, o pedido de
// cambio/agendamiento -- ahí el mensaje NO es una simple confirmación.
const REGEX_EXCLUSION = new RegExp(
  '\\b(' + [
    'no', 'ni', 'nunca', 'tampoco', 'imposible', 'jamas', 'sin poder',
    'cuando', 'cuanto', 'cuantos', 'como', 'donde', 'cual', 'cuales', 'que hora', 'a que hora', 'por que', 'porque',
    'cambi', 'cambiar', 'cambio', 'reagend', 'reagendar', 'reprogram', 'cancel', 'cancelar', 'anul', 'anular',
    'pero', 'aunque', 'adelant', 'adelantar', 'atrasar', 'posterg', 'postergar', 'mover', 'moverla', 'otra hora', 'otro dia',
    'puede', 'puedo', 'podria', 'podrian', 'quisiera', 'quiero', 'necesito', 'agendar', 'reservar', 'hora para', 'una hora',
    'cotizar', 'precio', 'cuesta', 'valor',
    // dudas / pensarlo / ir a otro lado / no poder ir (revisión 2026-10-06:
    // "voy a pensarlo", "iré a otra óptica", "estaré de vacaciones" NO son
    // confirmaciones de asistencia)
    'pensar', 'pensarlo', 'pensando', 'ver', 'averiguar', 'consultar', 'consulta', 'evaluar', 'decidir', 'quizas', 'tal vez', 'capaz',
    'me voy', 'otro', 'otra', 'otros', 'otras', 'vacaciones', 'viaje', 'viajando', 'fuera', 'afuera', 'ausente', 'lamentablemente',
    'ocupado', 'ocupada', 'enfermo', 'enferma', 'trabajando', 'trabajo',
  ].join('|') + ')\\b'
);

const MAX_CARACTERES = 70;

/**
 * @param {string} texto
 * @returns {boolean} true si parece una confirmación de asistencia corta y sin matices.
 */
function esConfirmacionDeAsistencia(texto) {
  if (typeof texto !== 'string') return false;
  const crudo = texto.trim();
  if (!crudo || crudo.length > MAX_CARACTERES) return false;
  if (/[?¿]/.test(crudo)) return false;

  const t = normalizar(crudo);
  if (!t) return false;
  if (REGEX_EXCLUSION.test(t)) return false;
  return REGEX_ASISTENCIA.test(t);
}

// ¿El mensaje menciona un día de la semana, una fecha o una hora concreta?
// Sin una cita pendiente que lo respalde, "voy el sábado" puede ser alguien
// que quiere AGENDAR para ese día -- ahí no se responde con un simple "te
// esperamos" (ver server.js).
const REGEX_FECHA_U_HORA = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las|a la una|\d{1,2}\s?(:|h|hrs|horas)|\d{1,2}\s?(de|\/|-)\s?\d{1,2})\b|\d/;

function mencionaFechaOHoraConcreta(texto) {
  return REGEX_FECHA_U_HORA.test(normalizar(texto));
}

const VARIANTES_RESPUESTA = [
  '¡Perfecto, te esperamos! 😊',
  '¡Genial, te esperamos! 😊',
  '¡Excelente! Te esperamos 😊',
  '¡Súper! Te esperamos 🙌',
];

// Variante determinística según el largo del mensaje (sin aleatoriedad, para
// que sea testeable y reproducible, pero sin repetir siempre la misma frase).
function respuestaDeAsistencia(texto) {
  return VARIANTES_RESPUESTA[String(texto || '').length % VARIANTES_RESPUESTA.length];
}

module.exports = { esConfirmacionDeAsistencia, mencionaFechaOHoraConcreta, respuestaDeAsistencia };
