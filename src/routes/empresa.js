// src/routes/empresa.js
//
// GET /empresa/ejemplos-formulario
// Ejemplos (placeholder) para los campos de texto libre del panel, según
// el rubro de la empresa — ver RubroTemplate.ejemplosFormulario.
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

const CAMPOS_INFO = ['direccion', 'notaAgendamiento', 'informacionAdicional', 'requiereRut', 'tonoComunicacion', 'telefonoContacto', 'minutosAlertaUrgente'];

const GRAPH_API_VERSION = 'v21.0';

// ------------------------------------------------------------
// GET /empresa/ejemplos-formulario
// Ejemplos (placeholder) para los campos de texto libre del panel —
// { nombreRecurso, direccion, informacionAdicional } según el rubro de la
// empresa, más el primer servicio sugerido del rubro (para el placeholder
// de "agregar servicio"). Antes esos campos mostraban siempre los mismos
// ejemplos con datos reales de Ahorróptica (dirección real, precios reales
// de óptica) sin importar el rubro del negocio.
// ------------------------------------------------------------
router.get('/ejemplos-formulario', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      select: { rubroTemplate: { select: { ejemplosFormulario: true, serviciosBase: true } } },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const ejemplosFormulario = empresa.rubroTemplate?.ejemplosFormulario || {};
    const serviciosBase = Array.isArray(empresa.rubroTemplate?.serviciosBase) ? empresa.rubroTemplate.serviciosBase : [];
    const ejemploServicio = typeof serviciosBase[0] === 'string' ? serviciosBase[0] : null;

    res.json({ ...ejemplosFormulario, ejemploServicio });
  } catch (error) {
    console.error('Error en GET /empresa/ejemplos-formulario:', error);
    res.status(500).json({ error: 'Error al obtener los ejemplos del formulario' });
  }
});

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
        telefonoContacto: true,
        minutosAlertaUrgente: true,
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
      } else if (campo === 'minutosAlertaUrgente') {
        const minutos = Number(req.body.minutosAlertaUrgente);
        if (!Number.isInteger(minutos) || minutos < 0) {
          return res.status(400).json({ error: 'minutosAlertaUrgente debe ser un número entero mayor o igual a 0' });
        }
        data.minutosAlertaUrgente = minutos;
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
        tonoComunicacion: true,
        telefonoContacto: true,
        minutosAlertaUrgente: true,
      },
    });

    res.json(empresaActualizada);
  } catch (error) {
    console.error('Error en PUT /empresa/info:', error);
    res.status(500).json({ error: 'Error al actualizar la información del negocio' });
  }
});

// ------------------------------------------------------------
// Plantillas rápidas — respuestas predefinidas para insertar con un clic
// al responder manualmente en "Chats en vivo" (botón "plantilla rápida",
// antes sin funcionalidad). Mismo nivel de auth que responder un chat
// (requireAuth, sin restringir a ADMIN) — ver POST /conversaciones/.../mensaje.
// ------------------------------------------------------------
router.get('/plantillas-rapidas', requireAuth, async (req, res) => {
  try {
    const plantillas = await prisma.plantillaRapida.findMany({
      where: { empresaId: req.usuario.empresaId },
      orderBy: { creadoEn: 'asc' },
    });
    res.json(plantillas);
  } catch (error) {
    console.error('Error en GET /empresa/plantillas-rapidas:', error);
    res.status(500).json({ error: 'Error al obtener las plantillas rápidas' });
  }
});

router.post('/plantillas-rapidas', requireAuth, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto || typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ error: 'texto es obligatorio' });
    }

    const plantilla = await prisma.plantillaRapida.create({
      data: { empresaId: req.usuario.empresaId, texto: texto.trim() },
    });
    res.status(201).json(plantilla);
  } catch (error) {
    console.error('Error en POST /empresa/plantillas-rapidas:', error);
    res.status(500).json({ error: 'Error al crear la plantilla rápida' });
  }
});

router.delete('/plantillas-rapidas/:id', requireAuth, async (req, res) => {
  try {
    const plantilla = await prisma.plantillaRapida.findUnique({ where: { id: req.params.id } });
    if (!plantilla || plantilla.empresaId !== req.usuario.empresaId) {
      return res.status(404).json({ error: 'Plantilla rápida no encontrada' });
    }

    await prisma.plantillaRapida.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /empresa/plantillas-rapidas/:id:', error);
    res.status(500).json({ error: 'Error al eliminar la plantilla rápida' });
  }
});

/**
 * Switch maestro del Catálogo Visual — controla si el bot puede ofrecer
 * imágenes durante la conversación. Apagado por defecto para toda empresa.
 */
router.patch('/catalogo-visual-activo', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    if (typeof req.body.catalogoVisualActivo !== 'boolean') {
      return res.status(400).json({ error: 'catalogoVisualActivo debe ser true o false' });
    }

    const empresa = await prisma.empresa.update({
      where: { id: req.usuario.empresaId },
      data: { catalogoVisualActivo: req.body.catalogoVisualActivo },
      select: { catalogoVisualActivo: true },
    });

    res.json(empresa);
  } catch (error) {
    console.error('Error en PATCH /empresa/catalogo-visual-activo:', error);
    res.status(500).json({ error: 'Error al actualizar el catálogo visual' });
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
  const { code, wabaId } = req.body;
  // phoneNumberId es opcional: en el flujo "conectar app existente"
  // (Coexistence), Meta manda el evento FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING
  // por postMessage, que solo trae waba_id (no phone_number_id) — ver
  // GET /{wabaId}/phone_numbers más abajo, que lo resuelve en ese caso.
  let phoneNumberId = req.body.phoneNumberId;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Falta "code" (el token corto que entrega FB.login())' });
  }
  if (!wabaId || typeof wabaId !== 'string') {
    return res.status(400).json({ error: 'Falta "wabaId"' });
  }
  if (phoneNumberId != null && typeof phoneNumberId !== 'string') {
    return res.status(400).json({ error: '"phoneNumberId" debe ser texto si se envía' });
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

    // Paso 1.5: si el frontend no mandó phoneNumberId (flujo Coexistence,
    // evento FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING — solo trae waba_id),
    // lo resolvemos acá. Documentado por Meta: el número ya está registrado
    // en ese flujo, así que no hay que registrarlo, solo identificarlo.
    if (!phoneNumberId) {
      const urlNumerosWaba = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`;
      const respuestaNumeros = await fetch(urlNumerosWaba);
      const datosNumeros = await respuestaNumeros.json();

      if (!respuestaNumeros.ok || !Array.isArray(datosNumeros.data)) {
        console.error('[EMBEDDED SIGNUP] Error al listar phone_numbers de la WABA:', JSON.stringify(datosNumeros));
        return res.status(502).json({ error: 'No se pudo obtener el número de WhatsApp de la cuenta conectada', detalle: datosNumeros.error?.message });
      }
      if (datosNumeros.data.length !== 1) {
        console.error(`[EMBEDDED SIGNUP] La WABA ${wabaId} tiene ${datosNumeros.data.length} números, se esperaba exactamente 1:`, JSON.stringify(datosNumeros.data));
        return res.status(502).json({ error: `La cuenta de WhatsApp conectada tiene ${datosNumeros.data.length} números — se esperaba exactamente uno` });
      }

      phoneNumberId = datosNumeros.data[0].id;
    }

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

    // Paso 2.5: suscribir la app a los webhooks de la WABA. Se asumía que
    // Embedded Signup hacía esto automáticamente (ver comentario en
    // scripts/conectar-whatsapp-manual.js, que sí lo hace explícito para el
    // Plan B) — resultó falso: Ahorróptica se conectó por este flujo oficial
    // y el bot nunca recibió sus mensajes reales, porque Meta nunca tenía a
    // quién avisarle. Sin este paso, ninguna conexión por Embedded Signup
    // recibe webhooks de mensajes entrantes, sin importar qué tan bien haya
    // salido el resto del intercambio de tokens.
    const urlSuscripcion = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`;
    const respuestaSuscripcion = await fetch(urlSuscripcion, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const datosSuscripcion = await respuestaSuscripcion.json();

    if (!respuestaSuscripcion.ok || !datosSuscripcion.success) {
      console.error('[EMBEDDED SIGNUP] Error al suscribir la app a los webhooks de la WABA:', JSON.stringify(datosSuscripcion));
      return res.status(502).json({ error: 'No se pudo completar la conexión de WhatsApp (falló la suscripción a webhooks) — no se guardó nada, hay que reintentar', detalle: datosSuscripcion.error?.message });
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