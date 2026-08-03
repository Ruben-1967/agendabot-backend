/**
 * src/routes/demos.js
 *
 * Rutas para demos y conversión de prospectos a clientes reales
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

// Función para hashear contraseña
function hashPassword(password) {
  const crypto = require('crypto');
  return crypto
    .createHash('sha256')
    .update(password + (process.env.PASSWORD_SALT || 'salt-temporal'))
    .digest('hex');
}

/**
 * GET /demos
 * Obtiene lista de demos asignadas a un usuario
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const demos = await prisma.demoAsignada.findMany({
      where: { usuarioId },
      include: {
        empresa: {
          select: { nombre: true, rubroTemplate: { select: { nombre: true } } },
        },
      },
    });

    res.json(demos);
  } catch (error) {
    console.error('Error en GET /demos:', error);
    res.status(500).json({ error: 'Error al obtener demos' });
  }
});

/**
 * POST /demos/nueva-demo
 * Crea una demo nueva asignada a un usuario vendedor
 */
router.post('/nueva-demo', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const { nombreProspecto, telefonoProspecto, rubroId } = req.body;
    const usuarioId = req.usuario.id;

    if (!nombreProspecto || !telefonoProspecto || !rubroId) {
      return res.status(400).json({
        error: 'Faltan campos: nombreProspecto, telefonoProspecto, rubroId',
      });
    }

    const rubro = await prisma.rubroTemplate.findUnique({
      where: { id: rubroId },
    });

    if (!rubro) {
      return res.status(404).json({ error: 'Rubro no encontrado' });
    }

    const demo = await prisma.demoAsignada.create({
      data: {
        nombreProspecto,
        telefonoProspecto,
        rubroId,
        usuarioId,
        estado: 'ACTIVA',
        conversacionJson: {
          mensajes: [
            {
              tipo: 'sistema',
              contenido: 'Demo creada',
              timestamp: new Date(),
            },
          ],
        },
      },
    });

    res.json(demo);
  } catch (error) {
    console.error('Error en POST /demos/nueva-demo:', error);
    res.status(500).json({ error: 'Error al crear demo' });
  }
});

/**
 * GET /demos/:id
 * Obtiene una demo por ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const demo = await prisma.demoAsignada.findUnique({
      where: { id },
      include: {
        empresa: true,
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    if (!demo) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }

    res.json(demo);
  } catch (error) {
    console.error('Error en GET /demos/:id:', error);
    res.status(500).json({ error: 'Error al obtener demo' });
  }
});

/**
 * POST /demos/convertir-a-cliente-real
 * CAMBIO PRINCIPAL: Ahora incluye creación de usuario con contraseña
 * Convierte un prospecto de demo en cliente real con período de prueba de 5 días
 */
router.post('/convertir-a-cliente-real', async (req, res) => {
  try {
    const { nombreNegocio, rubro, telefonoWhatsApp, correoContacto, password, sitioWeb } = req.body;

    // Validar campos obligatorios
    if (!nombreNegocio || !rubro || !telefonoWhatsApp || !correoContacto || !password) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios: nombreNegocio, rubro, telefonoWhatsApp, correoContacto, password',
      });
    }

    // Validar contraseña
    if (password.length < 8) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 8 caracteres',
      });
    }

    // Validar que rubro existe
    const rubroTemplate = await prisma.rubroTemplate.findUnique({
      where: { id: rubro },
      select: { serviciosBase: true, camposFicha: true },
    });

    if (!rubroTemplate) {
      return res.status(400).json({ error: 'Rubro inválido' });
    }

    // Crear empresa REAL con período de prueba + usuario + información
    const nuevaEmpresa = await prisma.$transaction(async (tx) => {
      // 1. Crear empresa
      const empresa = await tx.empresa.create({
        data: {
          nombre: nombreNegocio,
          rubroTemplateId: rubro,
          pruebahasta: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 días
        },
      });

      // 2. Crear usuario con contraseña hasheada
      const passwordHash = hashPassword(password);
      const usuario = await tx.usuario.create({
        data: {
          email: correoContacto,
          nombre: nombreNegocio,
          rol: 'ADMIN',
          empresaId: empresa.id,
          passwordHash,
        },
      });

      // 3. Crear información adicional de la empresa
      await tx.informacionNegocio.create({
        data: {
          empresaId: empresa.id,
          telefonoContacto: telefonoWhatsApp,
          correoContacto: correoContacto,
          sitioWeb: sitioWeb || null,
          servicios: rubroTemplate.serviciosBase?.join(', ') || 'Servicios generales',
          informacionAdicional: `Bienvenido a ${nombreNegocio}. Sistema en período de prueba.`,
        },
      });

      // 4. Crear servicios base según rubro
      if (rubroTemplate.serviciosBase && Array.isArray(rubroTemplate.serviciosBase)) {
        await tx.servicio.createMany({
          data: rubroTemplate.serviciosBase.map((nombreServicio, idx) => ({
            empresaId: empresa.id,
            nombre: nombreServicio,
            duracion: 30 + idx * 15,
            activo: true,
          })),
        });
      }

      return { empresa, usuario };
    });

    res.json({
      empresaId: nuevaEmpresa.empresa.id,
      nombre: nuevaEmpresa.empresa.nombre,
      email: nuevaEmpresa.usuario.email,
      mensaje: 'Empresa y usuario creados exitosamente con período de prueba de 5 días',
      proximoPaso: 'Accede al panel admin con tus credenciales',
    });
  } catch (error) {
    console.error('Error en POST /demos/convertir-a-cliente-real:', error);
    res.status(500).json({ error: 'Error al crear empresa real' });
  }
});

/**
 * DELETE /demos/:id
 * Elimina una demo (soft delete)
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const demo = await prisma.demoAsignada.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ mensaje: 'Demo eliminada', demo });
  } catch (error) {
    console.error('Error en DELETE /demos/:id:', error);
    res.status(500).json({ error: 'Error al eliminar demo' });
  }
});

module.exports = router;