const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { limitadorLogin } = require('../middleware/rateLimiting');
const router = express.Router();
const TOKEN_EXPIRA_EN = '12h';

// ------------------------------------------------------------
// POST /auth/login
// body: { email, password }
// ------------------------------------------------------------
router.post('/login', limitadorLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan email o password' });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { empresa: { include: { rubroTemplate: true } }, recursoAgendable: true },
    });

    // Mismo mensaje genérico si el email no existe o la clave no calza,
    // para no revelar cuáles emails están registrados.
    if (!usuario) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const payload = {
      userId: usuario.id,
      empresaId: usuario.empresaId,
      rol: usuario.rol,
      recursoAgendableId: usuario.recursoAgendableId,
      nombre: usuario.nombre,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRA_EN });

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        empresaModoOperacion: usuario.empresa.rubroTemplate.modoOperacion,
        recursoAgendableId: usuario.recursoAgendableId,
        recursoAgendableNombre: usuario.recursoAgendable?.nombre || null,
      },
    });
  } catch (error) {
    console.error('Error en /auth/login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ------------------------------------------------------------
// GET /auth/me — para que el frontend valide el token al cargar
// ------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
