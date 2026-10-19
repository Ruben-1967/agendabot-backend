/**
 * src/lib/estadoServicio.js
 *
 * Corte de servicio por impago (decisión 2026-10-19). Con la suscripción en
 * PAUSADA_POR_IMPAGO (la pone src/jobs/impagos.js tras avisar dos veces):
 *   - el bot de WhatsApp deja de responder (ver server.js);
 *   - en el panel se puede entrar, ver y EDITAR lo existente, y exportar datos,
 *     pero no CREAR registros nuevos: se rechazan los POST salvo los de la lista
 *     RUTAS_POST_PERMITIDAS (login, pagos, conexión de canales, validaciones y
 *     operaciones sobre registros que ya existen). Ver requireAuth.
 * Solo actúa con BLOQUEO_IMPAGO_ACTIVO='true' (apagado por defecto).
 */

const prisma = require('./prisma');

const MENSAJE_PAUSADA =
  'Tu cuenta está pausada por un pago pendiente. Puedes ver y editar tus datos, pero no crear registros nuevos hasta regularizar el pago. Escríbenos a contacto@multidigital.cl.';

// POST que NO crean registros del negocio (o que son necesarios para regularizar).
const RUTAS_POST_PERMITIDAS = [
  /^\/auth\//,
  /^\/suscripcion\//,
  /^\/billetera\//,
  /^\/empresa\/(whatsapp|instagram|facebook)\/conectar$/,
  /^\/disponibilidad\/[^/]+\/validar$/,
  /^\/clientes\/[^/]+\/fusionar-en\/[^/]+$/,
  /^\/agenda\/citas\/[^/]+\/reagendar$/,
  // El personal sigue pudiendo contestar a sus clientes desde "Chats en vivo":
  // con el bot pausado es la única vía de atención que les queda.
  /^\/conversaciones\/[^/]+\/[^/]+\/mensaje$/,
];

function esPostPermitido(ruta) {
  return RUTAS_POST_PERMITIDAS.some((re) => re.test(ruta));
}

async function serviciosPausadosPorImpago(empresaId) {
  if (process.env.BLOQUEO_IMPAGO_ACTIVO !== 'true' || !empresaId) return false;
  const s = await prisma.suscripcion.findUnique({ where: { empresaId }, select: { estado: true } });
  return s?.estado === 'PAUSADA_POR_IMPAGO';
}

module.exports = { MENSAJE_PAUSADA, esPostPermitido, serviciosPausadosPorImpago };
