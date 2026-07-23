const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { JWT_SECRET } = require('../middleware/auth');
const { limitadorLogin } = require('../middleware/rateLimiting');
const router = express.Router();
const TOKEN_EXPIRA_EN = '12h';

// ------------------------------------------------------------
// POST /auth-vendedor/login
// body: { email, password }
// ------------------------------------------------------------
router.post('/login', limitadorLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan email o password' });
    }

    const vendedor = await prisma.vendedor.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Mismo mensaje genérico si no existe, la clave no calza, o está
    // deshabilitado — no revelamos cuáles emails están registrados ni
    // cuáles fueron dados de baja.
    if (!vendedor || !vendedor.activo) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordValida = await bcrypt.compare(password, vendedor.passwordHash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const payload = { vendedorId: vendedor.id, rol: 'VENDEDOR', nombre: vendedor.nombre };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRA_EN });

    res.json({
      token,
      vendedor: { id: vendedor.id, nombre: vendedor.nombre, email: vendedor.email },
    });
  } catch (error) {
    console.error('Error en /auth-vendedor/login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

module.exports = router;