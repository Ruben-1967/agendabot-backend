const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { sendWhatsAppTextMessage } = require('../services/whatsapp');
const { listarEjemplosParaResumen, obtenerEjemploCompleto } = require('../lib/ejemplosDemoChats');

const router = express.Router();

// GET /conversaciones/:empresaId - Traer todas las conversaciones
router.get('/:empresaId', requireAuth, async (req, res) => {
  try {
    const { empresaId } = req.params;

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { esDemo: true } });

    const conversaciones = await prisma.conversacion.findMany({
      where: { empresaId },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            telefono: true,
          },
        },
      },
      orderBy: { actualizadoEn: 'desc' },
    });

    // Procesar para agregar último mensaje y status
    const conversacionesProcesadas = conversaciones.map((conv) => {
      const mensajesList = Array.isArray(conv.mensajes) ? conv.mensajes : [];
      const ultimoMensaje = mensajesList[mensajesList.length - 1];

      return {
        id: conv.id,
        clienteNombre: conv.cliente?.nombre || conv.telefono,
        telefono: conv.telefono,
        clienteId: conv.clienteId,
        ultimoMensaje: ultimoMensaje?.contenido || '—',
        ultimoMensajeTimestamp: ultimoMensaje?.timestamp || conv.actualizadoEn,
        ultimoMensajeRol: ultimoMensaje?.rol || null,
        totalMensajes: mensajesList.length,
        escaladoAHumano: conv.escaladoAHumano,
        actualizadoEn: conv.actualizadoEn,
        esEjemplo: false,
      };
    });

    // Empresas demo muestran además 3 conversaciones de ejemplo (siempre
    // dentro de las últimas 48h, calculadas al vuelo — ver ejemplosDemoChats.js)
    // para que el prospecto vea cómo luce el panel con varias conversaciones
    // activas, sin mezclarlas con sus propias interacciones reales.
    const listaCompleta = empresa?.esDemo
      ? [...conversacionesProcesadas, ...listarEjemplosParaResumen()].sort(
          (a, b) => new Date(b.actualizadoEn) - new Date(a.actualizadoEn)
        )
      : conversacionesProcesadas;

    res.json({
      total: listaCompleta.length,
      conversaciones: listaCompleta,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /conversaciones/:empresaId/pendientes/count - Cuántas conversaciones
// siguen pausadas esperando intervención humana (para el badge del panel).
// Liviano a propósito: se consulta por polling desde AdminLayout, en cada
// pantalla, no solo en "Chats en vivo".
router.get('/:empresaId/pendientes/count', requireAuth, async (req, res) => {
  try {
    const { empresaId } = req.params;

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const pendientes = await prisma.conversacion.count({
      where: { empresaId, pausadaPorHumanoEn: { not: null } },
    });

    res.json({ pendientes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /conversaciones/:empresaId/:conversacionId - Traer una conversación completa
router.get('/:empresaId/:conversacionId', requireAuth, async (req, res) => {
  try {
    const { empresaId, conversacionId } = req.params;

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (conversacionId.startsWith('ejemplo-')) {
      const ejemplo = obtenerEjemploCompleto(conversacionId);
      if (!ejemplo) {
        return res.status(404).json({ error: 'Conversación no encontrada' });
      }
      return res.json({ conversacion: ejemplo });
    }

    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            telefono: true,
            email: true,
          },
        },
      },
    });

    if (!conversacion || conversacion.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    // Procesar mensajes
    const mensajesList = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];

    res.json({
      conversacion: {
        id: conversacion.id,
        clienteNombre: conversacion.cliente?.nombre || conversacion.telefono,
        telefono: conversacion.telefono,
        cliente: conversacion.cliente,
        escaladoAHumano: conversacion.escaladoAHumano,
        mensajes: mensajesList,
        actualizadoEn: conversacion.actualizadoEn,
        creadoEn: conversacion.creadoEn,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /conversaciones/:empresaId/:conversacionId/mensaje - Agregar mensaje del admin
router.post('/:empresaId/:conversacionId/mensaje', requireAuth, async (req, res) => {
  try {
    const { empresaId, conversacionId } = req.params;
    const { contenido } = req.body;

    if (!contenido || typeof contenido !== 'string' || contenido.trim() === '') {
      return res.status(400).json({ error: 'Contenido del mensaje es requerido' });
    }

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (conversacionId.startsWith('ejemplo-')) {
      return res.status(400).json({ error: 'Esta es una conversación de ejemplo, no se puede responder' });
    }

    // Obtener conversación actual
    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
    });

    if (!conversacion || conversacion.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const accessToken = empresa?.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!accessToken || !empresa?.whatsappNumeroId) {
      return res.status(400).json({ error: 'Esta empresa no tiene WhatsApp conectado, no se puede enviar el mensaje' });
    }

    // Enviar primero por WhatsApp — si falla, no guardamos el mensaje como
    // si hubiera llegado al cliente (antes este endpoint solo lo guardaba
    // en la BD sin enviarlo nunca de verdad).
    try {
      await sendWhatsAppTextMessage({
        phoneNumberId: empresa.whatsappNumeroId,
        to: conversacion.telefono,
        text: contenido.trim(),
        accessToken,
      });
    } catch (errorEnvio) {
      return res.status(502).json({ error: `No se pudo enviar el mensaje por WhatsApp: ${errorEnvio.message}` });
    }

    // Construir array de mensajes
    const mensajesList = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];

    // Agregar nuevo mensaje
    const nuevoMensaje = {
      rol: 'admin',
      contenido: contenido.trim(),
      timestamp: new Date().toISOString(),
    };

    mensajesList.push(nuevoMensaje);

    // Actualizar conversación. pausadaPorHumanoEn reusa el mismo mecanismo
    // de pausa que Coexistence (ver src/jobs/pausaCoexistence.js) — así el
    // bot deja de responder automáticamente mientras un humano responde
    // desde el panel, igual que si hubiera respondido desde la app.
    const actualizada = await prisma.conversacion.update({
      where: { id: conversacionId },
      data: {
        mensajes: mensajesList,
        escaladoAHumano: true,
        pausadaPorHumanoEn: new Date(),
      },
      include: {
        cliente: {
          select: {
            nombre: true,
            telefono: true,
          },
        },
      },
    });

    res.json({
      message: 'Mensaje enviado',
      conversacion: actualizada,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;