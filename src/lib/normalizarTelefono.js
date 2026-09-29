// El teléfono es la llave del login sin contraseña (ver routes/auth.js,
// POST /auth/solicitar-codigo y POST /auth/verificar-codigo) -- dos formas
// distintas del mismo número tienen que matchear siempre, si no el usuario
// nunca encuentra su propia cuenta. No alcanza con sacar símbolos (+,
// espacios, guiones): "984084321" y "56984084321" son dígitos distintos, no
// hay forma de saber que al primero le falta el 56 sin pedirlo aparte. Por
// eso se usa libphonenumber-js (la misma librería que usa WhatsApp/Google)
// en vez de una limpieza casera -- mismo patrón ya probado en el proyecto
// hermano Norman (norman-medicamentos/src/lib/normalizarTelefono.js).
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Devuelve el número en dígitos puros al estilo E.164 sin el "+" (formato
// que espera la API de WhatsApp Cloud), o null si no se pudo validar como
// un teléfono real de algún país -- null es una señal explícita para que
// el caller responda con un error claro en vez de guardar basura.
function normalizarTelefono(telefono) {
  if (!telefono) return null;
  const limpio = telefono.trim();
  if (!limpio) return null;

  // Si no viene con "+", asumimos que el código de país ya está pegado
  // adelante (ej. "56984084321") -- no hay un país por defecto seguro para
  // asumir cuando falta el código completo, así que ese caso simplemente no
  // valida (ver abajo) y el usuario tiene que agregarlo.
  const conMas = limpio.startsWith('+') ? limpio : `+${limpio}`;
  const parsed = parsePhoneNumberFromString(conMas);

  if (!parsed || !parsed.isValid()) return null;
  return parsed.number.replace('+', '');
}

// Mensaje reusado en todas las rutas que validan teléfono.
const ERROR_TELEFONO_INVALIDO =
  'El teléfono no es válido. Escríbelo con el código de tu país (ej: +56912345678, +573001234567, +15551234567).';

module.exports = { normalizarTelefono, ERROR_TELEFONO_INVALIDO };
