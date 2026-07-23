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

module.exports = { limitadorLogin };