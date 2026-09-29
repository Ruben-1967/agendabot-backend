// Límite de intentos de login — 5 intentos fallidos cada 15 minutos por IP,
// por cada endpoint de login. Evita ataques de fuerza bruta contra
// contraseñas sin necesitar infraestructura nueva (Redis, etc.) — basta la
// memoria del propio proceso para el volumen actual.

const rateLimit = require('express-rate-limit');

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // solo cuentan los intentos FALLIDOS
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
});

// Límite de solicitudes de reset de contraseña — 3 cada hora por IP. Cada
// solicitud dispara un WhatsApp real al número de contacto del negocio, así
// que además de evitar fuerza bruta/enumeración de emails, evita que se
// pueda spamear de WhatsApp a un negocio real repitiendo la solicitud.
const limitadorResetPassword = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
});

// Límite de solicitudes de código de acceso (login sin contraseña) — 8 cada
// 15 minutos por IP, más estricto que limitadorLogin porque cada solicitud
// dispara un WhatsApp real con costo (plantilla AUTHENTICATION) -- mismo
// valor que usa el proyecto hermano Norman para este mismo endpoint.
const limitadorCodigo = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados códigos solicitados, prueba de nuevo en unos minutos.' },
});

module.exports = { limitadorLogin, limitadorResetPassword, limitadorCodigo };