// Asistente 24/7 para sitios web: API pública del widget (public/asistente-web.js).
//
//   GET  /chat-web/widget.js            el script que se pega en el sitio
//   GET  /chat-web/config?clave=...     título, saludo y color de la burbuja
//   POST /chat-web/mensaje              { clave, sesion, texto } -> { respuesta, derivado }
//
// Usa el mismo motor que WhatsApp (chatbotEngine, modo informativo) con canal 'web': la
// conversación queda en Chats en vivo y, al derivar, el interesado entra a Clientes Web.
// Protecciones: solo desde los sitios del asistente (Origin), límite por IP, tope de
// mensajes por sesión y tope de conversaciones nuevas al mes (el plan).

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const {
  MAX_MENSAJES_POR_SESION, MAX_LARGO_MENSAJE, REGEX_SESION, MAX_CONVERSACIONES_NUEVAS_POR_IP_DIA,
  asistentePorClave, origenPermitido, inicioMesChile,
} = require('../lib/asistenteWeb');

const ARCHIVO_WIDGET = path.join(__dirname, '..', '..', 'public', 'asistente-web.js');

// Textos fijos (sin modelo) para cuando el asistente no puede responder.
function textoWhatsApp(asistente) {
  return asistente.whatsapp ? ` Escríbenos por WhatsApp: https://wa.me/${asistente.whatsapp}` : '';
}
// Después de que la persona dejó sus datos (chat derivado): solo se confirma, sin volver a
// invitarla a escribir por WhatsApp (Rubén, 11-nov: sonaba a que no habíamos tomado sus datos).
// eslint-disable-next-line no-unused-vars
const textoDerivado = (a) => '¡De nada! 🙌 Ya tenemos tus datos y te contactamos a la brevedad por WhatsApp.';
const textoLimite = (a) => `En este momento el asistente no está disponible.${textoWhatsApp(a) || ' Escríbenos por los datos de contacto del sitio.'}`;
const textoError = (a) => `Uy, tuve un problema para responderte.${textoWhatsApp(a) || ' Intenta de nuevo en un momento.'}`;

/**
 * @param {Object} deps - inyectables para las pruebas
 * @param {Object} deps.prisma
 * @param {Function} deps.procesarMensajeEntrante - chatbotEngine.procesarMensajeEntrante
 */
function crearRouterChatWeb({ prisma, procesarMensajeEntrante }) {
  const router = express.Router();
  // El body se lee aquí (el parser global de server.js se salta /chat-web): máximo 4 KB.
  router.use(express.json({ limit: '4kb' }));

  // CORS propio: solo los sitios del asistente (la clave viene en la query o el body).
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      res.header('Vary', 'Origin');
      const clave = req.query.clave || req.body?.clave;
      // El preflight (OPTIONS) no trae body: se acepta el origen si es de algún asistente.
      const permitido = clave
        ? origenPermitido(asistentePorClave(String(clave)), origin)
        : req.method === 'OPTIONS';
      if (permitido) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.header('Access-Control-Max-Age', '600');
      }
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  router.get('/widget.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(ARCHIVO_WIDGET);
  });

  router.get('/config', (req, res) => {
    const asistente = asistentePorClave(String(req.query.clave || ''));
    if (!asistente || !origenPermitido(asistente, req.get('origin'))) return res.status(403).json({ error: 'Asistente no disponible en este sitio' });
    res.json({ titulo: asistente.titulo, saludo: asistente.saludo, color: asistente.color, whatsapp: asistente.whatsapp || null });
  });

  // 15 mensajes por minuto por IP: una persona escribiendo rápido no llega; un script, sí.
  const limitador = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados mensajes seguidos. Espera un momento.' },
  });

  // Conversaciones NUEVAS por IP al día: sin esto, un script podía abrir las 150 del plan
  // en minutos y dejar el asistente "no disponible" el resto del mes. En memoria (se
  // reinicia con cada despliegue, suficiente para el volumen del piloto).
  const nuevasPorIp = new Map();
  function puedeAbrirConversacion(ip, ahora = Date.now()) {
    const dia = Math.floor(ahora / 86400000);
    const r = nuevasPorIp.get(ip);
    if (!r || r.dia !== dia) { nuevasPorIp.set(ip, { dia, n: 1 }); return true; }
    if (r.n >= MAX_CONVERSACIONES_NUEVAS_POR_IP_DIA) return false;
    r.n += 1;
    return true;
  }

  router.post('/mensaje', limitador, async (req, res) => {
    const { clave, sesion, texto } = req.body || {};
    const asistente = asistentePorClave(String(clave || ''));
    if (!asistente || !origenPermitido(asistente, req.get('origin'))) return res.status(403).json({ error: 'Asistente no disponible en este sitio' });
    if (typeof sesion !== 'string' || !REGEX_SESION.test(sesion)) return res.status(400).json({ error: 'Sesión inválida' });
    const mensaje = typeof texto === 'string' ? texto.trim() : '';
    if (!mensaje) return res.status(400).json({ error: 'Mensaje vacío' });
    if (mensaje.length > MAX_LARGO_MENSAJE) return res.status(400).json({ error: `El mensaje es muy largo (máximo ${MAX_LARGO_MENSAJE} caracteres)` });

    const telefonoCliente = `web:${sesion}`;
    try {
      const empresa = await prisma.empresa.findUnique({ where: { id: asistente.empresaId }, include: { rubroTemplate: true } });
      if (!empresa || !empresa.modoInformativo) return res.json({ respuesta: textoLimite(asistente), derivado: false, limite: true });

      const conversacion = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: telefonoCliente, canal: 'web' },
        select: { id: true, mensajes: true },
      });
      if (!conversacion) {
        // Conversación nueva: cuenta para el tope del plan.
        const delMes = await prisma.conversacion.count({
          where: { empresaId: empresa.id, canal: 'web', creadoEn: { gte: inicioMesChile() } },
        });
        if (delMes >= asistente.conversacionesMes) {
          console.warn(`[chat-web] ${clave}: tope de ${asistente.conversacionesMes} conversaciones del mes alcanzado.`);
          return res.json({ respuesta: textoLimite(asistente), derivado: false, limite: true });
        }
        if (!puedeAbrirConversacion(req.ip)) {
          console.warn(`[chat-web] ${clave}: IP ${req.ip} superó las ${MAX_CONVERSACIONES_NUEVAS_POR_IP_DIA} conversaciones nuevas del día.`);
          return res.json({ respuesta: textoLimite(asistente), derivado: false, limite: true });
        }
      } else if ((conversacion.mensajes || []).filter((m) => m.rol === 'usuario').length >= MAX_MENSAJES_POR_SESION) {
        return res.json({ respuesta: textoLimite(asistente), derivado: false, limite: true });
      }

      const resultado = await procesarMensajeEntrante({
        empresa, telefonoCliente, textoEntrante: mensaje, nombreContacto: null, canal: 'web',
      });
      // Sin respuesta = chat ya derivado (pausado para una persona): se confirma con texto fijo.
      if (!resultado?.respuestaTexto) return res.json({ respuesta: textoDerivado(asistente), derivado: true });

      const actual = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: telefonoCliente, canal: 'web' },
        select: { escaladoAHumano: true },
      });
      res.json({ respuesta: resultado.respuestaTexto, derivado: !!actual?.escaladoAHumano });
    } catch (error) {
      console.error(`[chat-web] Error con ${clave}/${sesion}:`, error.message);
      res.status(500).json({ respuesta: textoError(asistente), derivado: false });
    }
  });

  // Body demasiado grande o JSON roto: respuesta corta, sin llenar el log con el stack.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Mensaje demasiado grande' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Mensaje inválido' });
    console.error('[chat-web] Error inesperado:', err.message);
    res.status(500).json({ error: 'Error interno' });
  });

  return router;
}

module.exports = { crearRouterChatWeb };
