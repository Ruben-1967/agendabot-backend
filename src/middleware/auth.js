const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('ADVERTENCIA: JWT_SECRET no está definido en las variables de entorno.');
}

/**
 * Verifica el JWT enviado en el header Authorization: Bearer <token>.
 * Si es válido, deja el payload decodificado en req.usuario:
 *   { userId, empresaId, rol, recursoAgendableId, nombre }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el token de autenticación' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Uso: requireRole('ADMIN'), requireRole('ADMIN', 'RECEPCION'), etc.
 * Debe usarse DESPUÉS de requireAuth.
 */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
