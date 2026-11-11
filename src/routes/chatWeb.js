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
  crearBuscadorAsistentes, origenPermitido, inicioMesChile,
} = require('../lib/asistenteWeb');
const { avisarInteresadoWeb } = require('../lib/avisoInteresadoWeb');

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

const escaparHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Solo lo que hoy es cierto del sistema: qué se guarda, para qué, quién lo procesa y cómo pedir
// acceso o eliminación. Si cambia el tratamiento (plazos, proveedores), actualizar este texto.
function paginaPrivacidad(asistente) {
  const negocio = escaparHtml(asistente.nombreNegocio || asistente.titulo);
  const esMultidigital = /^multidigital$/i.test(String(asistente.nombreNegocio || '').trim());
  const correo = escaparHtml((asistente.correoAvisos || [])[0] || 'contacto@multidigital.cl');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aviso de privacidad del asistente · ${negocio}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#0B1D3A;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.6}h1{font-size:24px}h2{font-size:17px;margin-top:26px}p,li{font-size:15px;color:#334155}</style></head><body>
<h1>Aviso de privacidad del asistente de ${negocio}</h1>
<p>Este aviso explica qué hacemos con los datos que escribes en el chat del sitio web de ${negocio} (el «asistente»).</p>
<h2>Quién es responsable</h2>
<p>${esMultidigital
    ? '<b>Multidigital</b> (multidigital.cl) es responsable de tus datos.'
    : `<b>${negocio}</b> es responsable de tus datos. Multidigital (multidigital.cl) le presta el servicio del asistente y trata los datos solo por encargo de ${negocio}.`}</p>
<h2>Qué datos se guardan</h2>
<ul><li>Los mensajes que escribes en el chat y las respuestas del asistente.</li><li>Los datos que decidas entregar para que te contacten, como tu nombre, tu número de WhatsApp o teléfono y tu correo.</li></ul>
<p>No pidas ni entregues datos sensibles (de salud, financieros o claves) por este chat.</p>
<h2>Para qué se usan</h2>
<p>Para responder tus consultas y, si lo pides, para que el equipo de ${negocio} te contacte. Cuando dejas tus datos, se le envían a ${negocio} por correo junto con la conversación${esMultidigital ? '' : ', con una copia a Multidigital para el control del servicio'}. No se usan para publicidad de terceros ni se venden.</p>
<h2>Cómo funciona el asistente</h2>
<p>Las respuestas las genera un sistema de inteligencia artificial y pueden tener errores; la información oficial siempre la confirma el equipo de ${negocio}. Para funcionar, los mensajes son procesados por proveedores tecnológicos de Multidigital ubicados fuera de Chile (servicio de inteligencia artificial, servidores y envío de correos), que los tratan solo para prestar el servicio.</p>
<h2>Cuánto tiempo se guardan</h2>
<p>Mientras sean necesarios para atender tu consulta. Puedes pedir que se eliminen cuando quieras, escribiendo al correo de abajo.</p>
<h2>Tus derechos</h2>
<p>Puedes pedir acceso, rectificación, eliminación u oposición al uso de tus datos escribiendo a <a href="mailto:${correo}">${correo}</a>. Escribir en el chat es voluntario: si no estás de acuerdo con este aviso, no lo uses y contacta a ${negocio} por otro medio.</p>
</body></html>`;
}

/**
 * @param {Object} deps - inyectables para las pruebas
 * @param {Object} deps.prisma
 * @param {Function} deps.procesarMensajeEntrante - chatbotEngine.procesarMensajeEntrante
 * @param {Function} [deps.avisarInteresado] - aviso al negocio al derivar (por defecto, correo)
 * @param {Function} [deps.buscarAsistente] - clave -> config (por defecto, base de datos + lista fija)
 */
function crearRouterChatWeb({ prisma, procesarMensajeEntrante, avisarInteresado = avisarInteresadoWeb, buscarAsistente = crearBuscadorAsistentes(prisma) }) {
  const router = express.Router();
  // El body se lee aquí (el parser global de server.js se salta /chat-web): máximo 4 KB.
  router.use(express.json({ limit: '4kb' }));

  // CORS propio: solo los sitios del asistente (la clave viene en la query o el body).
  router.use((req, res, next) => corsPropio(req, res, next).catch(next));
  async function corsPropio(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
      res.header('Vary', 'Origin');
      const clave = req.query.clave || req.body?.clave;
      // El preflight (OPTIONS) no trae body: se acepta el origen si es de algún asistente.
      const permitido = clave
        ? origenPermitido(await buscarAsistente(String(clave)), origin)
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
  }

  router.get('/widget.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(ARCHIVO_WIDGET);
  });

  // Aviso de privacidad del asistente (Ley 21.719): página pública, generada para cada negocio.
  router.get('/privacidad', async (req, res) => {
    const asistente = await buscarAsistente(String(req.query.clave || ''));
    if (!asistente) return res.status(404).type('text/plain').send('Aviso no disponible');
    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(paginaPrivacidad(asistente));
  });

  router.get('/config', async (req, res) => {
    const asistente = await buscarAsistente(String(req.query.clave || ''));
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
    const asistente = await buscarAsistente(String(clave || ''));
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
        select: { id: true, mensajes: true, escaladoAHumano: true, pausadaPorHumanoEn: true },
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

      // Pausa antes de este mensaje, para saber si se deriva justo ahora. Se mira la pausa y no
      // escaladoAHumano: ese queda en true para siempre, y si la persona vuelve días después
      // (el job de pausa reactivó el bot) y deja datos de nuevo, también hay que avisar.
      const pausaAntes = conversacion?.pausadaPorHumanoEn ? new Date(conversacion.pausadaPorHumanoEn).getTime() : 0;
      const resultado = await procesarMensajeEntrante({
        empresa, telefonoCliente, textoEntrante: mensaje, nombreContacto: null, canal: 'web',
      });
      // Sin respuesta = chat ya derivado (pausado para una persona): se confirma con texto fijo.
      if (!resultado?.respuestaTexto) return res.json({ respuesta: textoDerivado(asistente), derivado: true });

      const actual = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: telefonoCliente, canal: 'web' },
        select: { escaladoAHumano: true, pausadaPorHumanoEn: true },
      });
      const derivado = !!actual?.escaladoAHumano;
      const pausaDespues = actual?.pausadaPorHumanoEn ? new Date(actual.pausadaPorHumanoEn).getTime() : 0;
      // Recién derivado en este mensaje: se avisa al negocio una sola vez (sin esperar el correo).
      if (pausaDespues > pausaAntes) {
        avisarInteresado({ prisma, asistente, empresaId: empresa.id, telefonoCliente });
      }
      res.json({ respuesta: resultado.respuestaTexto, derivado });
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
