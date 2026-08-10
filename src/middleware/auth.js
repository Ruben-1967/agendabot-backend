const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('ADVERTENCIA: JWT_SECRET no está definido en las variables de entorno.');
}

/**
 * Verifica el JWT enviado en el header Authorization: Bearer <token>.
 * Si es válido, deja el payload decodificado en req.usuario:
 *   { userId, empresaId, rol, recursoAgendableId, nombre }
 *
 * Para JWT de vendedor (rol: 'VENDEDOR') se agrega una consulta a
 * Vendedor.activo en cada request — el JWT por sí solo es stateless y no se
 * entera si el admin bloqueó al vendedor después de emitido, así que sin
 * este chequeo un vendedor bloqueado seguiría con acceso completo hasta que
 * el token expire (12h, ver TOKEN_EXPIRA_EN en authVendedor.js). Es una
 * consulta por primary key dentro de un request que de todas formas ya va a
 * tocar la base — costo marginal, no una conexión nueva. No aplica a los
 * JWT de Usuario (panel de negocio), que no pasan por esta rama.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el token de autenticación' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (payload.rol === 'VENDEDOR') {
      const vendedor = await prisma.vendedor.findUnique({
        where: { id: payload.vendedorId },
        select: { activo: true },
      });
      if (!vendedor || !vendedor.activo) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }
    }

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

/**
 * Gatea rutas admin-only del panel de vendedores (config de ranking, SLA,
 * marcar suscripción como pagada). Requiere un JWT de vendedor (rol: 'VENDEDOR')
 * cuyo rolVendedor sea 'ADMIN' — distinto del RolUsuario del panel de la
 * empresa cliente. Debe usarse DESPUÉS de requireAuth.
 */
function requireRolVendedorAdmin(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (req.usuario.rol !== 'VENDEDOR' || req.usuario.rolVendedor !== 'ADMIN') {
    return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireRolVendedorAdmin, JWT_SECRET };
