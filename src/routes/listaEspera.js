const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /lista-espera/:empresaId
router.get('/:empresaId', requireAuth, async (req, res) => {
  try {
    const { empresaId } = req.params;

    if (req.user.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const listaEspera = await prisma.listaEspera.findMany({
      where: { empresaId },
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
      orderBy: { creadoEn: 'asc' },
    });

    const listaConPosicion = listaEspera.map((item, index) => ({
      ...item,
      posicion: index + 1,
    }));

    res.json({
      total: listaConPosicion.length,
      listaEspera: listaConPosicion,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /lista-espera
router.post('/', requireAuth, async (req, res) => {
  try {
    const { empresaId, clienteId, preferenciaRecursoId, preferenciaFranja } = req.body;

    if (!empresaId || !clienteId) {
      return res.status(400).json({ error: 'empresaId y clienteId requeridos' });
    }

    if (req.user.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
    });

    if (!cliente || cliente.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const yaEnLista = await prisma.listaEspera.findFirst({
      where: {
        empresaId,
        clienteId,
        estado: { not: 'CANCELADO' },
      },
    });

    if (yaEnLista) {
      return res.status(409).json({ error: 'Cliente ya en lista de espera' });
    }

    const nuevoRegistro = await prisma.listaEspera.create({
      data: {
        empresaId,
        clienteId,
        preferenciaRecursoId: preferenciaRecursoId || null,
        preferenciaFranja: preferenciaFranja || null,
        estado: 'ESPERANDO',
      },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            telefono: true,
          },
        },
      },
    });

    res.status(201).json({
      message: 'Cliente agregado a lista de espera',
      listaEspera: nuevoRegistro,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /lista-espera/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const registro = await prisma.listaEspera.findUnique({
      where: { id },
    });

    if (!registro) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    if (req.user.empresaId !== registro.empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const actualizado = await prisma.listaEspera.update({
      where: { id },
      data: { estado: 'CANCELADO' },
    });

    res.json({
      message: 'Cliente removido de lista de espera',
      listaEspera: actualizado,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /lista-espera/:id/estado
router.patch('/:id/estado', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nuevoEstado } = req.body;

    const estadosValidos = ['ESPERANDO', 'OFRECIDO', 'CONFIRMADO', 'EXPIRADO', 'CANCELADO'];
    if (!estadosValidos.includes(nuevoEstado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const registro = await prisma.listaEspera.findUnique({
      where: { id },
    });

    if (!registro) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    if (req.user.empresaId !== registro.empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const actualizado = await prisma.listaEspera.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        ofrecidoEn: nuevoEstado === 'OFRECIDO' ? new Date() : registro.ofrecidoEn,
      },
    });

    res.json({
      message: `Estado actualizado a ${nuevoEstado}`,
      listaEspera: actualizado,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /lista-espera/:id/agendar
router.post('/:id/agendar', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fechaHoraInicio, fechaHoraFin, recursoAgendableId, servicioId } = req.body;

    if (!fechaHoraInicio || !fechaHoraFin || !recursoAgendableId) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const registro = await prisma.listaEspera.findUnique({
      where: { id },
    });

    if (!registro) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    if (req.user.empresaId !== registro.empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const cita = await tx.cita.create({
        data: {
          empresaId: registro.empresaId,
          recursoAgendableId,
          servicioId: servicioId || null,
          clienteId: registro.clienteId,
          fechaHoraInicio: new Date(fechaHoraInicio),
          fechaHoraFin: new Date(fechaHoraFin),
          estado: 'CONFIRMADA',
          origenCanal: 'panel',
          creadoEn: new Date(),
          actualizadoEn: new Date(),
        },
      });

      const listaActualizada = await tx.listaEspera.update({
        where: { id },
        data: { estado: 'CONFIRMADO' },
      });

      return { cita, listaEspera: listaActualizada };
    });

    res.json({
      message: 'Cliente agendado desde lista de espera',
      cita: resultado.cita,
      listaEspera: resultado.listaEspera,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;