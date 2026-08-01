const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /lista-espera/:empresaId - Traer clientes en lista de espera
router.get('/:empresaId', requireAuth, async (req, res) => {
  try {
    const { empresaId } = req.params;

    // Verificar autorización
    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado para esta empresa' });
    }

    // Obtener lista de espera
    const listaEspera = await prisma.listaEspera.findMany({
      where: {
        empresaId: empresaId,
        estado: { not: 'CANCELADO' }
      },
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

    // Agregar posición
    const listaConPosicion = listaEspera.map((item, index) => ({
      ...item,
      posicion: index + 1,
      diasEsperando: Math.floor((Date.now() - new Date(item.creadoEn).getTime()) / (1000 * 60 * 60 * 24))
    }));

    res.json({
      total: listaConPosicion.length,
      listaEspera: listaConPosicion,
    });
  } catch (err) {
    console.error('[LISTA-ESPERA] Error:', err);
    res.status(500).json({ error: 'Error al cargar lista de espera' });
  }
});

// POST /lista-espera - Agregar cliente a lista
router.post('/', requireAuth, async (req, res) => {
  try {
    const { empresaId, clienteId, preferenciaFranja } = req.body;

    if (!empresaId || !clienteId) {
      return res.status(400).json({ error: 'empresaId y clienteId requeridos' });
    }

    if (!req.usuario || req.usuario.empresaId !== empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const registro = await prisma.listaEspera.create({
      data: {
        empresaId,
        clienteId,
        preferenciaFranja: preferenciaFranja || null,
        estado: 'ESPERANDO',
      },
      include: {
        cliente: true,
      },
    });

    res.status(201).json({
      message: 'Cliente agregado a lista de espera',
      listaEspera: registro,
    });
  } catch (err) {
    console.error('[LISTA-ESPERA] Error POST:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /lista-espera/:id - Remover de lista
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const registro = await prisma.listaEspera.findUnique({
      where: { id },
    });

    if (!registro) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    if (!req.usuario || req.usuario.empresaId !== registro.empresaId) {
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
    console.error('[LISTA-ESPERA] Error DELETE:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /lista-espera/:id/estado - Cambiar estado
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

    if (!req.usuario || req.usuario.empresaId !== registro.empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const actualizado = await prisma.listaEspera.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        ofrecidoEn: nuevoEstado === 'OFRECIDO' ? new Date() : undefined,
      },
    });

    res.json({
      message: `Estado actualizado a ${nuevoEstado}`,
      listaEspera: actualizado,
    });
  } catch (err) {
    console.error('[LISTA-ESPERA] Error PATCH:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /lista-espera/:id/agendar - Agendar paciente desde lista de espera
router.post('/:id/agendar', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, hora, profesionalId } = req.body;

    if (!fecha || !hora) {
      return res.status(400).json({ error: 'Falta fecha u hora' });
    }

    // Obtener el registro de lista de espera
    const listaEsperaItem = await prisma.listaEspera.findUnique({
      where: { id },
      include: { cliente: true },
    });

    if (!listaEsperaItem) {
      return res.status(404).json({ error: 'Registro no encontrado en lista de espera' });
    }

    // Validar autorización
    if (!req.usuario || req.usuario.empresaId !== listaEsperaItem.empresaId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Obtener recurso agendable (usar preferenciaRecursoId o el primero disponible)
    let recursoId = listaEsperaItem.preferenciaRecursoId;
    
    if (!recursoId) {
      const recursoDefault = await prisma.recursoAgendable.findFirst({
        where: { empresaId: listaEsperaItem.empresaId },
        select: { id: true },
      });
      if (!recursoDefault) {
        return res.status(400).json({ error: 'No hay recurso agendable disponible' });
      }
      recursoId = recursoDefault.id;
    }

    // Obtener recurso con duración
    const recurso = await prisma.recursoAgendable.findUnique({
      where: { id: recursoId },
      select: { duracionCitaMinutos: true },
    });

    if (!recurso) {
      return res.status(404).json({ error: 'Recurso no encontrado' });
    }

    // Parsear fecha y hora
    const [año, mes, día] = fecha.split('-').map(Number);
    const [horaNum, minNum] = hora.split(':').map(Number);

    const fechaHoraInicio = new Date(año, mes - 1, día, horaNum, minNum, 0);
    const fechaHoraFin = new Date(
      fechaHoraInicio.getTime() + (recurso.duracionCitaMinutos || 30) * 60 * 1000
    );

    // Verificar que no haya conflicto con otras citas
    const conflicto = await prisma.cita.findFirst({
      where: {
        recursoAgendableId: recursoId,
        estado: { not: 'CANCELADA' },
        fechaHoraInicio: { lt: fechaHoraFin },
        fechaHoraFin: { gt: fechaHoraInicio },
      },
    });

    if (conflicto) {
      return res.status(400).json({ error: 'Hay un conflicto con otra cita en ese horario' });
    }

    // Crear la cita
    const cita = await prisma.cita.create({
      data: {
        empresaId: listaEsperaItem.empresaId,
        clienteId: listaEsperaItem.clienteId,
        recursoAgendableId: recursoId,
        fechaHoraInicio,
        fechaHoraFin,
        profesionalAsignadoId: profesionalId || null,
        estado: 'CONFIRMADA',
        origenCanal: 'panel',
      },
      include: {
        cliente: true,
        recurso: true,
      },
    });

    // Actualizar lista de espera a CONFIRMADO
    await prisma.listaEspera.update({
      where: { id },
      data: { estado: 'CONFIRMADO' },
    });

    res.json({
      message: 'Paciente agendado correctamente',
      cita,
    });
  } catch (error) {
    console.error('Error en POST /lista-espera/:id/agendar:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;