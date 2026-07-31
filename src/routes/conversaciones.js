const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /conversaciones/:empresaId - Traer todas las conversaciones
router.get('/:empresaId', requireAuth, async (req, res) => {
  try {
    const { empresaId } = req.params;

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

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
      };
    });

    res.json({
      total: conversacionesProcesadas.length,
      conversaciones: conversacionesProcesadas,
    });
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

    // Obtener conversación actual
    const conversacion = await prisma.conversacion.findUnique({
      where: { id: conversacionId },
    });

    if (!conversacion || conversacion.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
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

    // Actualizar conversación
    const actualizada = await prisma.conversacion.update({
      where: { id: conversacionId },
      data: {
        mensajes: mensajesList,
        escaladoAHumano: true, // Marcar como ya respondido por admin
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