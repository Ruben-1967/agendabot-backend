// src/routes/empresa.js
//
// GET /empresa/info
// Devuelve los campos de "Información del negocio" de la empresa del
// usuario autenticado (dirección, nota de agendamiento, info adicional
// para el bot, y si exige RUT al agendar).
//
// PUT /empresa/info
// Actualiza esos mismos campos. Pensado para que sea el propio negocio
// (ej. Ahorróptica) quien los cargue desde el panel — reemplaza la carga
// manual por script en el Shell de Render.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const CAMPOS_INFO = ['direccion', 'notaAgendamiento', 'informacionAdicional', 'requiereRut'];

router.get('/info', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      select: {
        id: true,
        nombre: true,
        sucursal: true,
        direccion: true,
        notaAgendamiento: true,
        informacionAdicional: true,
        requiereRut: true,
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    res.json(empresa);
  } catch (error) {
    console.error('Error en GET /empresa/info:', error);
    res.status(500).json({ error: 'Error al obtener la información del negocio' });
  }
});

router.put('/info', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const data = {};

    for (const campo of CAMPOS_INFO) {
      if (!(campo in req.body)) continue;

      if (campo === 'requiereRut') {
        if (typeof req.body.requiereRut !== 'boolean') {
          return res.status(400).json({ error: 'requiereRut debe ser true o false' });
        }
        data.requiereRut = req.body.requiereRut;
      } else {
        // Los campos de texto son opcionales: string vacío o null los limpia.
        if (req.body[campo] !== null && typeof req.body[campo] !== 'string') {
          return res.status(400).json({ error: `${campo} debe ser texto` });
        }
        data[campo] = req.body[campo] === '' ? null : req.body[campo];
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No se envió ningún campo para actualizar' });
    }

    const empresaActualizada = await prisma.empresa.update({
      where: { id: req.usuario.empresaId },
      data,
      select: {
        id: true,
        nombre: true,
        sucursal: true,
        direccion: true,
        notaAgendamiento: true,
        informacionAdicional: true,
        requiereRut: true,
      },
    });

    res.json(empresaActualizada);
  } catch (error) {
    console.error('Error en PUT /empresa/info:', error);
    res.status(500).json({ error: 'Error al actualizar la información del negocio' });
  }
});

module.exports = router;