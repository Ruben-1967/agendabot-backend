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
//
// POST /empresa/whatsapp/conectar
// Recibe el "code" que entrega FB.login() (Embedded Signup v4) vía
// postMessage al panel, lo cambia por el token permanente de Meta y guarda
// los datos de WhatsApp de la empresa del usuario logueado. Reemplaza la
// carga manual que se hizo para Ahorróptica (ver guardar-whatsapp-ahoroptica.js).

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const CAMPOS_INFO = ['direccion', 'notaAgendamiento', 'informacionAdicional', 'requiereRut', 'tonoComunicacion'];

const GRAPH_API_VERSION = 'v21.0';

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
        tonoComunicacion: true,
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

/**
 * Cambia el "code" corto de Embedded Signup por el token permanente de
 * Meta y guarda los datos de WhatsApp de la empresa del usuario logueado.
 *
 * Body esperado: { code, wabaId, phoneNumberId } — los tres los entrega el
 * evento postMessage "WA_EMBEDDED_SIGNUP" que dispara FB.login() en el
 * panel; ninguno es secreto por sí solo (el secreto es META_APP_SECRET,
 * que nunca sale del backend).
 *
 * La empresa a actualizar sale de req.usuario.empresaId (JWT de sesión del
 * admin logueado), nunca de un campo enviado por el cliente — así evitamos
 * que alguien pueda apuntar el intercambio a una empresa ajena.
 */
router.post('/whatsapp/conectar', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { code, wabaId, phoneNumberId } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Falta "code" (el token corto que entrega FB.login())' });
  }
  if (!wabaId || typeof wabaId !== 'string') {
    return res.status(400).json({ error: 'Falta "wabaId"' });
  }
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    return res.status(400).json({ error: 'Falta "phoneNumberId"' });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    console.error('[EMBEDDED SIGNUP] Falta META_APP_ID o META_APP_SECRET en las variables de entorno.');
    return res.status(500).json({ error: 'Falta configuración del servidor para conectar WhatsApp' });
  }

  try {
    // Paso 1: cambiar el code corto por el token permanente.
    const urlIntercambio =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(code)}`;

    const respuestaIntercambio = await fetch(urlIntercambio);
    const datosIntercambio = await respuestaIntercambio.json();

    if (!respuestaIntercambio.ok || !datosIntercambio.access_token) {
      console.error('[EMBEDDED SIGNUP] Error al intercambiar el code por token:', JSON.stringify(datosIntercambio));
      return res.status(502).json({ error: 'Meta rechazó el intercambio de token', detalle: datosIntercambio.error?.message });
    }

    const accessToken = datosIntercambio.access_token;

    // Paso 2: confirmar el número real antes de guardar (valida además que
    // el token recién obtenido efectivamente tiene acceso a ese phoneNumberId).
    const urlNumero = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
    const respuestaNumero = await fetch(urlNumero, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const datosNumero = await respuestaNumero.json();

    if (!respuestaNumero.ok || !datosNumero.display_phone_number) {
      console.error('[EMBEDDED SIGNUP] Error al confirmar el número de teléfono:', JSON.stringify(datosNumero));
      return res.status(502).json({ error: 'No se pudo confirmar el número de WhatsApp con Meta', detalle: datosNumero.error?.message });
    }

    // Paso 3: guardar. whatsappToken se cifra solo (ver src/lib/prisma.js).
    const empresaActualizada = await prisma.empresa.update({
      where: { id: req.usuario.empresaId },
      data: {
        whatsappNumeroId: phoneNumberId,
        whatsappToken: accessToken,
        whatsappWabaId: wabaId,
        whatsappPhoneNumber: datosNumero.display_phone_number,
      },
      select: {
        id: true,
        nombre: true,
        whatsappNumeroId: true,
        whatsappWabaId: true,
        whatsappPhoneNumber: true,
      },
    });

    console.log(`[EMBEDDED SIGNUP] WhatsApp conectado para empresa ${empresaActualizada.id} (${empresaActualizada.nombre}): ${empresaActualizada.whatsappPhoneNumber}`);

    res.json(empresaActualizada);
  } catch (error) {
    console.error('[EMBEDDED SIGNUP] Error inesperado en POST /empresa/whatsapp/conectar:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

module.exports = router;