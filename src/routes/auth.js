const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { limitadorLogin, limitadorResetPassword } = require('../middleware/rateLimiting');
const { sendWhatsAppTextMessage } = require('../services/whatsapp');
const { obtenerUrlPanelPrincipal } = require('../lib/urlPanel');
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

    // findFirst (no findUnique) para poder comparar sin distinguir
    // mayúsculas/minúsculas — el email es @unique en el schema, así que de
    // todas formas nunca hay más de una fila que calce. Bug real
    // encontrado: un email guardado como "Alejandro@vargas.cl" (con
    // mayúscula) nunca calzaba si el cliente escribía "alejandro@vargas.cl"
    // en minúsculas al iniciar sesión — la comparación exacta anterior era
    // sensible a mayúsculas.
    const usuario = await prisma.usuario.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      include: { empresa: { include: { rubroTemplate: true, suscripcion: true } }, recursoAgendable: true },
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
        plan: usuario.empresa.suscripcion?.plan || null,
      },
    });

  } catch (error) {
    console.error('Error en /auth/login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ------------------------------------------------------------
// POST /auth/activar-cuenta
// body: { token, password }
// El cliente real (creado por un vendedor vía POST /demos/convertir-a-cliente-real)
// define su propia contraseña con el link único que le llegó por WhatsApp. No
// requiere autenticación previa — el token de activación hace ese papel.
// ------------------------------------------------------------
router.post('/activar-cuenta', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Faltan token o password' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { tokenActivacion: token } });

    if (!usuario || !usuario.tokenActivacionExpira || usuario.tokenActivacionExpira < new Date()) {
      return res.status(400).json({ error: 'El link de activación es inválido o expiró' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const usuarioActivado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash,
        tokenActivacion: null,
        tokenActivacionExpira: null,
        fechaActivacionCuenta: usuario.fechaActivacionCuenta || new Date(),
      },
      include: { empresa: { include: { rubroTemplate: true, suscripcion: true } }, recursoAgendable: true },
    });

    const payload = {
      userId: usuarioActivado.id,
      empresaId: usuarioActivado.empresaId,
      rol: usuarioActivado.rol,
      recursoAgendableId: usuarioActivado.recursoAgendableId,
      nombre: usuarioActivado.nombre,
    };
    const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRA_EN });

    // El link de activación es de un solo uso (tokenActivacion ya quedó en
    // null arriba) — sin esto, el negocio no tiene forma de saber a qué URL
    // volver la próxima vez que quiera entrar. No bloquea la respuesta si
    // falla (mismo criterio que el envío en convertir-a-cliente-real): la
    // cuenta ya quedó activada igual.
    try {
      const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
      const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
      if (phoneNumberId && accessToken && usuarioActivado.empresa.telefonoContacto) {
        const linkLogin = `${obtenerUrlPanelPrincipal()}/login`;
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: usuarioActivado.empresa.telefonoContacto,
          text: `¡Tu cuenta ya está activa! Para volver a entrar más adelante, usá este link con tu email y la contraseña que acabás de crear: ${linkLogin}`,
          accessToken,
        });
      }
    } catch (errWhatsapp) {
      console.error('[activar-cuenta] Error enviando WhatsApp de confirmación de login:', errWhatsapp.message);
    }

    res.json({
      token: jwtToken,
      usuario: {
        id: usuarioActivado.id,
        nombre: usuarioActivado.nombre,
        email: usuarioActivado.email,
        rol: usuarioActivado.rol,
        empresaId: usuarioActivado.empresaId,
        empresaNombre: usuarioActivado.empresa.nombre,
        empresaModoOperacion: usuarioActivado.empresa.rubroTemplate.modoOperacion,
        recursoAgendableId: usuarioActivado.recursoAgendableId,
        recursoAgendableNombre: usuarioActivado.recursoAgendable?.nombre || null,
        plan: usuarioActivado.empresa.suscripcion?.plan || null,
      },
    });
  } catch (error) {
    console.error('Error en /auth/activar-cuenta:', error);
    res.status(500).json({ error: 'Error al activar la cuenta' });
  }
});

// ------------------------------------------------------------
// POST /auth/solicitar-reset-password
// body: { email }
// Reutiliza el mismo mecanismo de tokenActivacion/tokenActivacionExpira que
// ya usa la activación inicial de cuenta (ver POST /auth/activar-cuenta) —
// "restablecer la contraseña" es, en la práctica, volver a emitir ese mismo
// link de un solo uso. No requiere autenticación (el usuario, por
// definición, no puede iniciar sesión). Siempre responde el mismo mensaje
// genérico exista o no el email, para no revelar qué emails están
// registrados — el envío real solo ocurre si el email existe.
// ------------------------------------------------------------
router.post('/solicitar-reset-password', limitadorResetPassword, async (req, res) => {
  const MENSAJE_GENERICO = { mensaje: 'Si el email está registrado, te enviamos un link para restablecer tu contraseña por WhatsApp al número de contacto del negocio.' };
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Falta el email' });
    }

    // findFirst insensitive por el mismo motivo que en /login — ver nota ahí.
    const usuario = await prisma.usuario.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      include: { empresa: true },
    });

    if (!usuario) {
      return res.json(MENSAJE_GENERICO);
    }

    const tokenActivacion = crypto.randomBytes(24).toString('hex');
    // Más corto que el de activación inicial (7 días) — un link de reset
    // solicitado a demanda no debería quedar utilizable por tanto tiempo.
    const tokenActivacionExpira = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { tokenActivacion, tokenActivacionExpira },
    });

    const linkReset = `${obtenerUrlPanelPrincipal()}/activar-cuenta?token=${tokenActivacion}&tipo=reset`;

    try {
      const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
      const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
      if (phoneNumberId && accessToken && usuario.empresa.telefonoContacto) {
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: usuario.empresa.telefonoContacto,
          text: `Recibimos una solicitud para restablecer la contraseña de tu cuenta de TotemSystem. Si fuiste tú, usa este link (válido por 2 horas) para crear una nueva: ${linkReset}\n\nSi no fuiste tú, puedes ignorar este mensaje.`,
          accessToken,
        });
      } else {
        console.error(`[solicitar-reset-password] No se pudo enviar WhatsApp a ${usuario.empresa.nombre} — falta configuración o teléfono de contacto.`);
      }
    } catch (errWhatsapp) {
      console.error('[solicitar-reset-password] Error enviando WhatsApp:', errWhatsapp.message);
    }

    res.json(MENSAJE_GENERICO);
  } catch (error) {
    console.error('Error en /auth/solicitar-reset-password:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// ------------------------------------------------------------
// GET /auth/me — para que el frontend valide el token al cargar
// ------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  res.json({ usuario: req.usuario });
});

// ------------------------------------------------------------
// POST /auth/cambiar-contraseña — NUEVO
// body: { passwordActual, passwordNueva, passwordConfirmar }
// Requiere autenticación
// ------------------------------------------------------------
router.post('/cambiar-contraseña', requireAuth, async (req, res) => {
  try {
    const { passwordActual, passwordNueva, passwordConfirmar } = req.body;
    const usuarioId = req.usuario.userId;

    // Validar campos
    if (!passwordActual || !passwordNueva || !passwordConfirmar) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Validar que las nuevas contraseñas coincidan
    if (passwordNueva !== passwordConfirmar) {
      return res.status(400).json({ error: 'Las contraseñas nuevas no coinciden' });
    }

    // Validar longitud mínima
    if (passwordNueva.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Validar que no sea igual a la actual
    if (passwordActual === passwordNueva) {
      return res.status(400).json({ error: 'La contraseña nueva debe ser diferente' });
    }

    // Obtener usuario
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar contraseña actual
    const passwordValida = await bcrypt.compare(passwordActual, usuario.passwordHash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    // Hashear nueva contraseña
    const nuevoHash = await bcrypt.hash(passwordNueva, 10);

    // Actualizar en BD
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { passwordHash: nuevoHash },
    });

    res.json({
      success: true,
      mensaje: 'Contraseña actualizada exitosamente',
    });
  } catch (error) {
    console.error('Error en /auth/cambiar-contraseña:', error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

module.exports = router;