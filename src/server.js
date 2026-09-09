require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const crypto = require('crypto');
const {
  sendWhatsAppTextMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveList,
  sendWhatsAppReplyButtons,
  decodificarFilaHorario,
  codificarFilaHorario,
  decodificarFilaDia,
  codificarFilaDia,
  codificarFilaProductoDemo,
  codificarFilaCantidadDemo,
  codificarFilaRubroGenerico,
  decodificarFilaRubroGenerico,
  codificarBotonCategoriaGenerica,
  decodificarBotonCategoriaGenerica,
  codificarFilaServicio,
  decodificarFilaServicio,
  ID_FILA_SERVICIO_OTRO,
  codificarFilaServicioDemo,
  ID_FILA_SERVICIO_OTRO_DEMO,
} = require('./services/whatsapp');
const { obtenerHorariosDisponibles } = require('./services/disponibilidad');
const { fechaLegibleDesdeISO } = require('./lib/formatoFechas');
const { procesarMensajeEntrante } = require('./services/chatbotEngine');
const { sendInstagramTextMessage, armarTextoConInteractivo } = require('./services/instagram');
const { sendFacebookTextMessage, armarTextoConInteractivo: armarTextoConInteractivoFacebook } = require('./services/facebook');
const { renderFormulario, PLANES } = require('./services/contratoHtml');
const authRouter = require('./routes/auth');
const campanasRouter = require('./routes/campanas');
const productosRouter = require('./routes/productos');
const pedidosRouter = require('./routes/pedidos');
const clientesRouter = require('./routes/clientes');
const billeteraRouter = require('./routes/billetera');
const empresaRouter = require('./routes/empresa');
const catalogoRouter = require('./routes/catalogo');
const recordatorioControlAnualRouter = require('./routes/recordatorioControlAnual');
const agendaRouter = require('./routes/agenda');
const serviciosRouter = require('./routes/servicios');
const { procesarMensajeCatalogoRotativo } = require('./services/pedidosEngine');
const { procesarMensajeDemo } = require('./services/demoEngine');
const { sincronizarLeadDesdeDemo } = require('./services/leadSync');
const { CIERRE_ELABORADO_DEMO } = require('./config/remateDemoPanel');
const authVendedorRouter = require('./routes/authVendedor');
const demosRouter = require('./routes/demos');
const { generarHorasSimuladasParaDia } = require('./lib/agendaDemoSimulada');
const { renderPanelDemo } = require('./services/panelDemoHtml');
const { renderSitioNegocio } = require('./services/sitioNegocioHtml');
const listaEsperaRouter = require('./routes/listaEspera');
const conversacionesRouter = require('./routes/conversaciones');
const suscripcionRouter = require('./routes/suscripcion');
const websiteLeadsRouter = require('./routes/websiteLeads');
const { iniciarJobBloqueoVencidas } = require('./jobs/bloquearEmpresasVencidas');

// Job de opt-in de campañas (node-cron autoprogramado dentro de este mismo
// proceso — ver src/jobs/enviarPreguntaOptIn.js). Requerirlo una sola vez
// activa su cron.schedule interno.
require('./jobs/enviarPreguntaOptIn');
require('./jobs/rankingCache');
require('./jobs/cierreRankingMensual');
require('./jobs/pausaCoexistence');
iniciarJobBloqueoVencidas();

const app = express();
app.set('trust proxy', 1);

// En desarrollo, si PANEL_FRONTEND_URL no está definida, se permite cualquier
// origen para no bloquear pruebas locales. En producción, definir esa env var
// con la URL real del Static Site del panel (ej. https://agendabot-panel.onrender.com)
const origenesPermitidos = process.env.PANEL_FRONTEND_URL
  ? process.env.PANEL_FRONTEND_URL.split(',').map((s) => s.trim())
  : true;

app.use(express.json({
  // 8mb para cubrir imágenes de hasta 5MB del Catálogo Visual codificadas en
  // base64 (~6.8MB) más margen para el resto del payload JSON.
  limit: '8mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Middleware CORS con soporte para múltiples orígenes. Bug real encontrado
// (2026-09-07): este bloque ignoraba `origenesPermitidos` (calculado arriba,
// correcto: sin PANEL_FRONTEND_URL definida, permite cualquier origen para
// no bloquear pruebas locales/staging) y en su lugar hardcodeaba la URL de
// producción del panel como único fallback -- contradiciendo el propio
// comentario de arriba, y bloqueando cualquier prueba local o de Staging
// que no tuviera esa env var seteada exactamente igual.
app.use((req, res, next) => {
  const origen = req.get('origin');
  const permitido = origenesPermitidos === true || origenesPermitidos.includes(origen) || origenesPermitidos.includes('*');

  if (permitido) {
    res.header('Access-Control-Allow-Origin', origen);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ------------------------------------------------------------
// Verificación de firma de Meta (X-Hub-Signature-256) — confirma que el
// webhook realmente viene de Meta y no de un tercero que descubrió la URL.
// Se prueba contra los secretos de las 2 apps (producción y demos), porque
// ambas comparten esta misma URL de webhook.
// ------------------------------------------------------------
function verificarFirmaWebhookWhatsApp(req, res, next) {
  const headerFirma = req.header('x-hub-signature-256');
  if (!headerFirma || !headerFirma.startsWith('sha256=')) {
    console.warn('[SEGURIDAD] Webhook de WhatsApp sin firma X-Hub-Signature-256 — rechazado.');
    return res.sendStatus(401);
  }

  const secretosAppMeta = [process.env.WHATSAPP_APP_SECRET, process.env.DEMO_WHATSAPP_APP_SECRET].filter(Boolean);
  if (secretosAppMeta.length === 0) {
    console.error('[SEGURIDAD] Ningún WHATSAPP_APP_SECRET configurado — no se puede verificar el webhook. Rechazando por seguridad.');
    return res.sendStatus(401);
  }

  const firmaRecibida = Buffer.from(headerFirma.slice('sha256='.length), 'hex');

  const esValida = secretosAppMeta.some((secreto) => {
    const firmaCalculada = Buffer.from(
      crypto.createHmac('sha256', secreto).update(req.rawBody).digest('hex'),
      'hex'
    );
    return firmaCalculada.length === firmaRecibida.length && crypto.timingSafeEqual(firmaCalculada, firmaRecibida);
  });

  if (!esValida) {
    console.warn('[SEGURIDAD] Firma de webhook de WhatsApp inválida — posible request falso, rechazado.');
    return res.sendStatus(401);
  }

  next();
}

// ------------------------------------------------------------
// Verificación de firma del webhook de Instagram — mismo mecanismo HMAC que
// WhatsApp de arriba, pero con el app secret de la app de Instagram (canal
// nuevo, 2026-09-08, habilitado solo para LuxVision — ver EMPRESA_ID_LUXVISION
// más abajo). Solo una app, a diferencia de WhatsApp que prueba contra 2
// (producción y demos) porque Instagram no tiene un flujo de demo aparte.
// ------------------------------------------------------------
function verificarFirmaWebhookInstagram(req, res, next) {
  const headerFirma = req.header('x-hub-signature-256');
  if (!headerFirma || !headerFirma.startsWith('sha256=')) {
    console.warn('[SEGURIDAD] Webhook de Instagram sin firma X-Hub-Signature-256 — rechazado.');
    return res.sendStatus(401);
  }

  const secretoAppMeta = process.env.INSTAGRAM_APP_SECRET;
  if (!secretoAppMeta) {
    console.error('[SEGURIDAD] INSTAGRAM_APP_SECRET no configurado — no se puede verificar el webhook. Rechazando por seguridad.');
    return res.sendStatus(401);
  }

  const firmaRecibida = Buffer.from(headerFirma.slice('sha256='.length), 'hex');
  const firmaCalculada = Buffer.from(
    crypto.createHmac('sha256', secretoAppMeta).update(req.rawBody).digest('hex'),
    'hex'
  );
  const esValida = firmaCalculada.length === firmaRecibida.length && crypto.timingSafeEqual(firmaCalculada, firmaRecibida);

  if (!esValida) {
    console.warn('[SEGURIDAD] Firma de webhook de Instagram inválida — posible request falso, rechazado.');
    return res.sendStatus(401);
  }

  next();
}

// ------------------------------------------------------------
// Verificación de firma del webhook de Messenger (Facebook) — mismo
// mecanismo que Instagram arriba, con el app secret propio (canal nuevo,
// 2026-09-09, habilitado solo para LuxVision).
// ------------------------------------------------------------
function verificarFirmaWebhookFacebook(req, res, next) {
  const headerFirma = req.header('x-hub-signature-256');
  if (!headerFirma || !headerFirma.startsWith('sha256=')) {
    console.warn('[SEGURIDAD] Webhook de Messenger sin firma X-Hub-Signature-256 — rechazado.');
    return res.sendStatus(401);
  }

  const secretoAppMeta = process.env.FACEBOOK_APP_SECRET;
  if (!secretoAppMeta) {
    console.error('[SEGURIDAD] FACEBOOK_APP_SECRET no configurado — no se puede verificar el webhook. Rechazando por seguridad.');
    return res.sendStatus(401);
  }

  const firmaRecibida = Buffer.from(headerFirma.slice('sha256='.length), 'hex');
  const firmaCalculada = Buffer.from(
    crypto.createHmac('sha256', secretoAppMeta).update(req.rawBody).digest('hex'),
    'hex'
  );
  const esValida = firmaCalculada.length === firmaRecibida.length && crypto.timingSafeEqual(firmaCalculada, firmaRecibida);

  if (!esValida) {
    console.warn('[SEGURIDAD] Firma de webhook de Messenger inválida — posible request falso, rechazado.');
    return res.sendStatus(401);
  }

  next();
}

// Instagram Direct como canal nuevo (2026-09-08): arquitectura general,
// disponible para cualquier Empresa en el código, pero habilitada y visible
// solo para LuxVision por ahora (mismo patrón cauteloso ya usado para el
// recordatorio de control anual y el opt-in de marketing, ver
// src/routes/empresa.js — declarada por separado acá porque no existe una
// tabla de feature flags ni un módulo compartido de constantes). Reusada
// igual para Messenger (2026-09-09, mismo criterio).
const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';

app.use('/auth', authRouter);
app.use('/campanas', campanasRouter);
app.use('/productos', productosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/clientes', clientesRouter);
app.use('/billetera', billeteraRouter);
app.use('/empresa', empresaRouter);
app.use('/empresa/catalogo', catalogoRouter);
app.use('/empresa/recordatorio-control-anual', recordatorioControlAnualRouter);

app.use('/agenda', agendaRouter);
app.use('/servicios', serviciosRouter);
app.use('/plantillas-ficha', require('./routes/plantillasFicha'));
app.use('/auth-vendedor', authVendedorRouter);
app.use('/demos', demosRouter);
app.use('/lista-espera', listaEsperaRouter);
app.use('/conversaciones', conversacionesRouter);
app.use('/disponibilidad', require('./routes/disponibilidad'));
app.use('/suscripcion', suscripcionRouter);
app.use('/website-leads', websiteLeadsRouter);
app.use('/admin-vendedores', require('./routes/adminVendedores'));
app.use('/admin-vendedores/catalogo-demo', require('./routes/catalogoDemoAdmin'));
app.use('/leads', require('./routes/leads'));
app.use('/ranking', require('./routes/ranking'));
app.use('/gestion-venta', require('./routes/gestionVenta'));


app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'AgendaBot backend' });
});

// Nombres legibles de las categorías del menú genérico (número desconocido
// que escribe al número de demo) — claves = RubroTemplate.modoOperacion.
const NOMBRES_CATEGORIA_GENERICA = {
  AGENDAMIENTO: 'Agendamiento de citas',
  CATALOGO_ROTATIVO: 'Catálogo por WhatsApp',
};

// ------------------------------------------------------------
// Espejo de la conversación de demo en Conversacion, para que la pantalla
// "Chats en vivo" del panel (pensada originalmente solo para clientes
// reales) también muestre y permita responder demos — sin tocar el motor
// de demo (demoEngine.js) ni su propio historial (DemoAsignada.historialSimulacion).
// ------------------------------------------------------------
function extraerTextoLegibleDeMensaje(mensaje) {
  if (mensaje.type === 'text') return mensaje.text?.body || '';
  if (mensaje.type === 'button') return mensaje.button?.text || '[botón]';
  if (mensaje.type === 'interactive') {
    return mensaje.interactive?.list_reply?.title || mensaje.interactive?.button_reply?.title || '[selección]';
  }
  return '[mensaje]';
}

async function registrarTurnoDemoEnConversacion({ empresaId, telefono, textoUsuario, textoAsistente }) {
  const conversacion = await prisma.conversacion.findFirst({ where: { empresaId, telefono } });
  const historialPrevio = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];
  const mensajesActualizados = [
    ...historialPrevio,
    { rol: 'usuario', contenido: textoUsuario, timestamp: new Date().toISOString() },
    ...(textoAsistente ? [{ rol: 'asistente', contenido: textoAsistente, timestamp: new Date().toISOString() }] : []),
  ];

  await prisma.conversacion.upsert({
    where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
    update: { mensajes: mensajesActualizados },
    create: { empresaId, telefono, mensajes: mensajesActualizados },
  });

  return conversacion;
}

// ------------------------------------------------------------
// WEBHOOK DE WHATSAPP (Meta) — verificación inicial
// ------------------------------------------------------------
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook de WhatsApp verificado correctamente.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ------------------------------------------------------------
// WEBHOOK DE INSTAGRAM (Meta) — verificación inicial, mismo mecanismo que
// el de WhatsApp de arriba.
// ------------------------------------------------------------
app.get('/webhook/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('Webhook de Instagram verificado correctamente.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ------------------------------------------------------------
// WEBHOOK DE MESSENGER (Facebook) — verificación inicial, mismo mecanismo.
// ------------------------------------------------------------
app.get('/webhook/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    console.log('Webhook de Messenger verificado correctamente.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ------------------------------------------------------------
// WEBHOOK DE WHATSAPP — recepción de mensajes entrantes
// ------------------------------------------------------------
app.post('/webhook/whatsapp', verificarFirmaWebhookWhatsApp, async (req, res) => {
  // Respondemos 200 de inmediato: Meta espera una respuesta rápida (<5s)
  // y reintenta / desactiva el webhook si tarda demasiado o falla seguido.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];

    // Diagnóstico de Embedded Signup: Meta documenta que dispara el webhook
    // "account_update" cuando un cliente completa el flujo de conexión de
    // WhatsApp — independiente del postMessage del navegador (que se probó
    // poco confiable: FB.login() puede reportar éxito y aun así no llegar
    // nunca el postMessage de cierre). Antes esto se descartaba en silencio
    // junto con el resto de campos que no son "messages"; ahora se loguea
    // completo para poder correlacionar con los intentos reales de conectar
    // WhatsApp desde el panel.
    if (change?.field && change.field !== 'messages') {
      console.log(`[WEBHOOK WHATSAPP] Campo "${change.field}" recibido (no es un mensaje):`, JSON.stringify(req.body));
    }

    // ------------------------------------------------------------
    // Coexistence (WhatsApp Business App + Cloud API activas en paralelo):
    // un mensaje enviado por un humano desde la app de WhatsApp Business
    // llega acá como un webhook separado, field "smb_message_echoes" — no
    // dentro de "messages" como un mensaje entrante normal. Al detectarlo,
    // pausamos el bot para esa conversación puntual (ver
    // Conversacion.pausadaPorHumanoEn); el ciclo de contención/alerta/
    // reactivación corre aparte, en src/jobs/pausaCoexistence.js.
    //
    // TODO-VERIFICAR-CON-CASO-REAL: esta detección se escribió contra la
    // documentación oficial de Meta (developers.facebook.com/documentation/
    // business-messaging/whatsapp/webhooks/reference/smb_message_echoes),
    // sin poder probarla contra un negocio real con Coexistence conectado
    // (no existe ninguno todavía — ver memoria del proyecto: la única
    // conexión intentada nunca se guardó en el backend). Apenas haya un
    // primer caso real, confirmar que el payload coincide con lo asumido
    // acá (field="smb_message_echoes", value.message_echoes[].from = número
    // propio del negocio, .to = número del cliente) antes de confiar en
    // este mecanismo para un cliente real.
    // ------------------------------------------------------------
    if (change?.field === 'smb_message_echoes') {
      const eco = value?.message_echoes?.[0];
      const phoneNumberIdEco = value?.metadata?.phone_number_id;

      if (eco && phoneNumberIdEco) {
        const empresaEco = await prisma.empresa.findFirst({ where: { whatsappNumeroId: phoneNumberIdEco } });
        const telefonoClienteEco = eco.to; // destinatario del echo = cliente (eco.from es el número propio del negocio)

        if (empresaEco && telefonoClienteEco) {
          const clienteEco = await prisma.cliente.findFirst({
            where: { empresaId: empresaEco.id, telefono: telefonoClienteEco },
          });

          const conversacionEco = await prisma.conversacion.findFirst({
            where: { empresaId: empresaEco.id, telefono: telefonoClienteEco },
          });

          if (conversacionEco) {
            await prisma.conversacion.update({
              where: { id: conversacionEco.id },
              data: { pausadaPorHumanoEn: new Date() },
            });
          } else {
            // Humano escribió primero, antes de que el cliente le hablara
            // nunca al bot — no hay Conversacion todavía, se crea ya pausada.
            await prisma.conversacion.create({
              data: {
                empresaId: empresaEco.id,
                clienteId: clienteEco?.id || null,
                telefono: telefonoClienteEco,
                mensajes: [],
                pausadaPorHumanoEn: new Date(),
              },
            });
          }

          console.log(`[COEXISTENCE] Echo detectado — bot pausado para ${telefonoClienteEco} (${empresaEco.nombre}).`);
        }
      }
      return;
    }
    // ---- fin bloque de echo de Coexistence ----

    // Aceptamos mensajes de texto libre, clics en botones de plantillas, y
    // selecciones de listas interactivas (usadas por el catálogo rotativo).
    // Ignoramos silenciosamente cualquier otro tipo (imágenes, ubicación,
    // confirmaciones de entrega/lectura, cambios de estado de cuenta, etc.).
    if (!mensaje || !['text', 'button', 'interactive'].includes(mensaje.type)) {
      return;
    }

    const phoneNumberId = value.metadata?.phone_number_id;
    const telefonoCliente = mensaje.from; // ej. "56912345678"
    const nombreContacto = value.contacts?.[0]?.profile?.name || null;

    // ------------------------------------------------------------
    // NUEVO: detección de modo demo. Si el mensaje llegó al número
    // dedicado a demos (no a un número real de cliente), se enruta
    // al motor de demo en vez del flujo normal de Empresa real.
    // ------------------------------------------------------------
    if (phoneNumberId === process.env.DEMO_PHONE_NUMBER_ID) {
      let demoAsignada = await prisma.demoAsignada.findUnique({
        where: { telefono: telefonoCliente },
        include: { empresaDemo: { include: { rubroTemplate: true } } },
      });

      const accessTokenDemo = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

      // Si un admin le respondió manualmente a esta demo desde "Chats en
      // vivo", el bot se pausa igual que en el flujo real (ver
      // pausadaPorHumanoEn en chatbotEngine.js) — solo persistimos el
      // mensaje del prospecto y no seguimos al motor de demo.
      if (demoAsignada) {
        const conversacionDemoPausada = await prisma.conversacion.findFirst({
          where: { empresaId: demoAsignada.empresaDemoId, telefono: telefonoCliente },
        });
        if (conversacionDemoPausada?.pausadaPorHumanoEn) {
          await registrarTurnoDemoEnConversacion({
            empresaId: demoAsignada.empresaDemoId,
            telefono: telefonoCliente,
            textoUsuario: extraerTextoLegibleDeMensaje(mensaje),
          });
          return;
        }
      }

     if (!demoAsignada) {
        // Único paso del menú genérico: se muestran directamente los
        // rubros Reactivos (AGENDAMIENTO). Catálogo (Proactivo) queda
        // oculto por ahora — decisión de negocio, ver memoria del proyecto.
        const rubroTemplateElegidoId = mensaje.type === 'interactive'
          ? decodificarFilaRubroGenerico(mensaje.interactive?.list_reply?.id)
          : null;
        const rubroTemplate = rubroTemplateElegidoId
          ? await prisma.rubroTemplate.findUnique({ where: { id: rubroTemplateElegidoId } })
          : null;

        if (!rubroTemplate) {
          // Nadie asignó este teléfono a ninguna demo todavía (o no
          // reconocimos la respuesta) — muestra directamente la lista de
          // rubros Reactivos disponibles, sin paso previo de categoría.
          const rubrosReactivos = await prisma.rubroTemplate.findMany({
            where: { modoOperacion: 'AGENDAMIENTO' },
            select: { id: true, nombre: true },
            orderBy: { nombre: 'asc' },
          });

          await sendWhatsAppInteractiveList({
            phoneNumberId,
            to: telefonoCliente,
            accessToken: accessTokenDemo,
            textoCuerpo: '¡Hola! 👋 Soy el asistente de *Totemsystem*. Elige el rubro que quieres ver funcionando por WhatsApp 👇',
            textoBoton: 'Ver rubros',
            textoHeader: 'Totemsystem — Demo',
            secciones: [{
              titulo: NOMBRES_CATEGORIA_GENERICA.AGENDAMIENTO,
              filas: rubrosReactivos.map((r) => ({
                id: codificarFilaRubroGenerico(r.id), titulo: r.nombre,
              })),
            }],
          });
          return;
        }

        // Eligió un rubro — crea una empresa PRIVADA nueva para este
        // teléfono (nunca compartida) y su DemoAsignada, todo en una sola
        // transacción. Si dos mensajes casi simultáneos llegan del mismo
        // número (ej. reintento de Meta), el segundo va a chocar con la
        // restricción única de `telefono` — en ese caso, en vez de fallar,
        // recuperamos la demo que ya creó el primero. La transacción
        // también evita que quede una Empresa/Producto huérfana si el
        // segundo intento falla a mitad de camino.
        try {
          const { empresaNueva } = await prisma.$transaction(async (tx) => {
            const empresaCreada = await tx.empresa.create({
              data: { nombre: `${rubroTemplate.nombre} Demo`, rubroTemplateId: rubroTemplate.id, esDemo: true },
            });

            if (rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO' && Array.isArray(rubroTemplate.serviciosBase) && rubroTemplate.serviciosBase.length > 0) {
              await tx.producto.createMany({
                data: rubroTemplate.serviciosBase.map((p) => ({
                  empresaId: empresaCreada.id, nombre: p.nombre, precio: p.precio, activo: true,
                })),
              });
            }

            await tx.demoAsignada.create({
              data: {
                telefono: telefonoCliente,
                empresaDemoId: empresaCreada.id,
                nombreProspecto: nombreContacto,
                origenDemo: 'organico',
                // La fila se crea reactivamente cuando el prospecto elige un
                // rubro — ese acto ya ES su primera interacción real, no hace
                // falta esperar un segundo mensaje para marcarla.
                primerMensajeProspectoEn: new Date(),
              },
            });

            return { empresaNueva: empresaCreada };
          });

          demoAsignada = await prisma.demoAsignada.findUnique({
            where: { telefono: telefonoCliente },
            include: { empresaDemo: { include: { rubroTemplate: true } } },
          });

          console.log(`[DEMO] Número desconocido ${telefonoCliente} eligió "${rubroTemplate.nombre}" — empresa privada ${empresaNueva.id} creada.`);

          // Captura inmediata: el Lead nace acá, en el primer mensaje real,
          // no cuando (o si) la demo se derive a un vendedor más tarde — ver
          // el gate ampliado en demoEngine.js. Best-effort: un error acá no
          // debe tumbar la respuesta de la demo al prospecto.
          try {
            await sincronizarLeadDesdeDemo(demoAsignada, null, rubroTemplate.nombre);
          } catch (errorLead) {
            console.error(`[DEMO] Error creando Lead inmediato para ${telefonoCliente}:`, errorLead.message);
          }
        } catch (error) {
          if (error.code === 'P2002') {
            // Condición de carrera: otro mensaje casi simultáneo del mismo
            // teléfono ya creó la demo primero — la recuperamos y seguimos
            // normal, sin duplicar nada.
            demoAsignada = await prisma.demoAsignada.findUnique({
              where: { telefono: telefonoCliente },
              include: { empresaDemo: { include: { rubroTemplate: true } } },
            });
            console.log(`[DEMO] Condición de carrera detectada para ${telefonoCliente} — se usó la demo creada por el mensaje concurrente.`);
          } else {
            throw error;
          }
        }

        if (!demoAsignada) {
          // Extremadamente improbable (la recuperación tras P2002 también
          // falló), pero mejor un mensaje claro que dejar tronar más abajo.
          await sendWhatsAppTextMessage({
            phoneNumberId, to: telefonoCliente, accessToken: accessTokenDemo,
            text: 'Tuvimos un problema armando esa demo — escríbenos a contacto@multidigital.cl y te ayudamos directo 🙌',
          });
          return;
        }
        // Sigue abajo con el flujo normal de demo (INICIO) — no hay return aquí.
      }

      // NUEVO: si el mensaje entrante es la selección de un DÍA en la demo,
      // lo interceptamos igual que en el flujo real, sin pasar por el motor
      // de demo — respondemos directo con las horas de ese día.
      if (mensaje.type === 'interactive') {
        const listReplyIdDemo = mensaje.interactive?.list_reply?.id;
        const diaElegidoDemo = decodificarFilaDia(listReplyIdDemo);
        if (diaElegidoDemo) {
          const horasDemo = generarHorasSimuladasParaDia(diaElegidoDemo.fecha);
          if (horasDemo.length === 0) {
            const textoSinCupo = 'Ese día ya no tiene cupo disponible, ¿quieres que te muestre otro?';
            await sendWhatsAppTextMessage({
              phoneNumberId, to: telefonoCliente, accessToken: accessTokenDemo,
              text: textoSinCupo,
            });
            await registrarTurnoDemoEnConversacion({
              empresaId: demoAsignada.empresaDemoId, telefono: telefonoCliente,
              textoUsuario: extraerTextoLegibleDeMensaje(mensaje), textoAsistente: textoSinCupo,
            });
            return;
          }
          const fechaLegibleDemo = fechaLegibleDesdeISO(diaElegidoDemo.fecha);
          const textoHorariosDemo = `Estos son los horarios disponibles para el ${fechaLegibleDemo}. Elige el que más te acomode 👇`;
          await sendWhatsAppInteractiveList({
            phoneNumberId, to: telefonoCliente, accessToken: accessTokenDemo,
            textoCuerpo: textoHorariosDemo,
            textoBoton: 'Ver horarios',
            textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
            filas: horasDemo.map((hora) => ({ id: codificarFilaHorario(diaElegidoDemo.fecha, hora), titulo: hora })),
          });
          await registrarTurnoDemoEnConversacion({
            empresaId: demoAsignada.empresaDemoId, telefono: telefonoCliente,
            textoUsuario: extraerTextoLegibleDeMensaje(mensaje), textoAsistente: textoHorariosDemo,
          });
          return;
        }
      }

      const { respuestaTexto, interactivo } = await procesarMensajeDemo({
        demoAsignada,
        telefonoCliente,
        mensaje,
        nombreContacto,
      });

      await registrarTurnoDemoEnConversacion({
        empresaId: demoAsignada.empresaDemoId,
        telefono: telefonoCliente,
        textoUsuario: extraerTextoLegibleDeMensaje(mensaje),
        textoAsistente: respuestaTexto,
      });

      if (interactivo?.tipo === 'lista_dias') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Ver días',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          secciones: [{
            titulo: 'Próximos días con hora',
            filas: interactivo.dias.map((d) => ({
              id: codificarFilaDia(d.fecha),
              titulo: fechaLegibleDesdeISO(d.fecha),
            })),
          }],
        });
      } else if (interactivo?.tipo === 'lista_horarios') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Ver horarios',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: interactivo.horas.map((hora) => ({
            id: codificarFilaHorario(interactivo.fecha, hora),
            titulo: hora,
          })),
        });
      } else if (interactivo?.tipo === 'catalogo_imagenes_demo') {
        // Máximo 4 imágenes por respuesta (ya viene acotado desde
        // demoEngine.js). Mismo patrón que el dispatcher real: texto
        // primero, luego cada imagen por separado. Si hay remate del panel
        // (ver src/config/remateDemoPanel.js), se manda encadenado al final
        // — no es una decisión del modelo, es determinista.
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: telefonoCliente,
          text: respuestaTexto,
          accessToken: accessTokenDemo,
        });
        for (const item of interactivo.items) {
          await sendWhatsAppImageMessage({
            phoneNumberId,
            to: telefonoCliente,
            accessToken: accessTokenDemo,
            imageUrl: item.imagenUrl,
            caption: item.nombre,
          });
        }
        if (interactivo.remate) {
          await sendWhatsAppTextMessage({
            phoneNumberId,
            to: telefonoCliente,
            text: interactivo.remate.texto,
            accessToken: accessTokenDemo,
          });
          await sendWhatsAppImageMessage({
            phoneNumberId,
            to: telefonoCliente,
            accessToken: accessTokenDemo,
            imageUrl: interactivo.remate.imagenUrl,
          });
          // Cierre elaborado, encadenado determinísticamente tras el remate
          // — no depende de que el modelo detecte que la conversación está
          // terminando (no existe ese detector), mismo criterio ya usado
          // para el resto del encadenado catálogo → remate.
          await sendWhatsAppTextMessage({
            phoneNumberId,
            to: telefonoCliente,
            text: CIERRE_ELABORADO_DEMO,
            accessToken: accessTokenDemo,
          });
        }
      } else if (interactivo?.tipo === 'lista_servicios_demo') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Ver servicios',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: [
            ...interactivo.servicios.map((s, i) => ({ id: codificarFilaServicioDemo(i), titulo: s })),
            { id: ID_FILA_SERVICIO_OTRO_DEMO, titulo: 'Otro / no lo encuentro', descripcion: 'Cuéntame qué necesitas' },
          ],
        });
      } else if (interactivo?.tipo === 'lista_productos_demo') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Ver menú',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: interactivo.productos.map((p) => ({
            id: codificarFilaProductoDemo(p.id),
            titulo: p.nombre,
            descripcion: `$${p.precio}`,
          })),
        });
      } else if (interactivo?.tipo === 'lista_desambiguacion_precio') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Elegir',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: interactivo.opciones.map((o) => ({ id: o.id, titulo: o.titulo, descripcion: o.descripcion })),
        });
      } else if (interactivo?.tipo === 'lista_forma_pago') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Elegir',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: interactivo.opciones.map((o) => ({ id: o.id, titulo: o.titulo, descripcion: o.descripcion })),
        });
      } else if (interactivo?.tipo === 'lista_tipo_entrega') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Elegir',
          textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
          filas: interactivo.opciones.map((o) => ({ id: o.id, titulo: o.titulo, descripcion: o.descripcion })),
        });
      } else if (interactivo?.tipo === 'lista_cantidad_demo') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Elegir',
          textoHeader: interactivo.nombreProducto?.slice(0, 60),
          filas: interactivo.opciones.map((o) => ({
            id: codificarFilaCantidadDemo(interactivo.productoId, o.cantidad),
            titulo: o.titulo,
            descripcion: o.descripcion,
          })),
        });
      } else if (interactivo?.tipo === 'imagen_panel_demo') {
        // Prospecto pidió ver "el panel" en medio de la conversación (no
        // tras el catálogo) — misma captura real de "Remate Panel" que el
        // remate, sin el cierre elaborado (no corresponde acá, no se mostró
        // catálogo). Ver detectaIntencionVerPanel en demoEngine.js.
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: telefonoCliente,
          text: respuestaTexto,
          accessToken: accessTokenDemo,
        });
        await sendWhatsAppImageMessage({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          imageUrl: interactivo.imagenUrl,
        });
      } else {
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: telefonoCliente,
          text: respuestaTexto,
          accessToken: accessTokenDemo,
        });
      }

      console.log(`[DEMO] Respondido a ${telefonoCliente} como "${demoAsignada.empresaDemo.nombre}"`);
      return; // IMPORTANTE: no seguir al flujo normal de Empresa real
    }
    // ---- fin bloque de demo ----

    // Identificar a qué empresa (tenant) pertenece este número de WhatsApp
    const empresa = await prisma.empresa.findFirst({
      where: { whatsappNumeroId: phoneNumberId },
      include: { rubroTemplate: true },
    });

    if (!empresa) {
      console.warn(`No se encontró ninguna Empresa para phone_number_id=${phoneNumberId}`);
      return;
    }

    // ------------------------------------------------------------
    // Corte de servicio por prueba vencida sin pago — ver
    // src/jobs/bloquearEmpresasVencidas.js. La marca bloqueadaPorPruebaVencida
    // la pone ese job; acá solo se actúa si el toggle está prendido, para
    // poder tener el mecanismo listo sin activarlo todavía en producción.
    // Responde al CLIENTE del negocio (quien escribió a pedir hora), no al
    // dueño del negocio — por eso el mensaje es neutro, sin mencionar pagos.
    // ------------------------------------------------------------
    if (empresa.bloqueadaPorPruebaVencida && process.env.BLOQUEO_PRUEBA_VENCIDA_ACTIVO === 'true') {
      const accessTokenBloqueo = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
      if (accessTokenBloqueo) {
        try {
          await sendWhatsAppTextMessage({
            phoneNumberId,
            to: telefonoCliente,
            accessToken: accessTokenBloqueo,
            text: 'Este canal de atención no está disponible en este momento. Por favor contacta directamente al local.',
          });
        } catch (errBloqueo) {
          console.error(`Error enviando aviso de servicio no disponible (empresa ${empresa.id}):`, errBloqueo.message);
        }
      }
      return;
    }
    // ---- fin corte de servicio por prueba vencida ----

    // ------------------------------------------------------------
    // Opt-in de campañas embebido en la conversación: intercepta el clic
    // en los botones Sí/No que manda src/jobs/enviarPreguntaOptIn.js —
    // antes de cualquier otro flujo (agendamiento o catálogo rotativo),
    // porque aplica por igual a ambos modos.
    // ------------------------------------------------------------
    if (mensaje.type === 'interactive' && mensaje.interactive?.type === 'button_reply') {
      const botonId = mensaje.interactive.button_reply.id;

      if (botonId === 'optin_si' || botonId === 'optin_no') {
        const clienteOptIn = await prisma.cliente.findFirst({
          where: { empresaId: empresa.id, telefono: telefonoCliente },
        });

        if (clienteOptIn) {
          const respuestaSi = botonId === 'optin_si';

          await prisma.cliente.update({
            where: { id: clienteOptIn.id },
            data: { optInCampanas: respuestaSi, optInPreguntaPendiente: false },
          });

          const accessTokenOptIn = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
          if (accessTokenOptIn) {
            await sendWhatsAppTextMessage({
              phoneNumberId,
              to: telefonoCliente,
              accessToken: accessTokenOptIn,
              text: respuestaSi
                ? '¡Perfecto! 🙂'
                : 'Entendido, no te enviaremos avisos de promociones. Igual puedes escribirnos cuando quieras.',
            });
          }

          console.log(`[OPT-IN] ${telefonoCliente} respondió "${botonId}" (${empresa.nombre}).`);
        }

        return; // ya respondimos, no seguir a ningún otro flujo
      }
    }
    // ---- fin bloque de opt-in ----

    // ------------------------------------------------------------
    // Confirmación del recordatorio escalonado de ficha clínica (ver
    // src/jobs/recordatoriosFicha.js). IMPORTANTE: los botones de una
    // PLANTILLA aprobada (enviados con sendWhatsAppTemplateMessage) llegan
    // como mensaje.type === 'button' con mensaje.button.text — NO como
    // mensaje.type === 'interactive' con button_reply.id (eso es solo para
    // botones interactivos libres tipo sendWhatsAppReplyButtons, que no
    // sirven acá porque solo funcionan dentro de la ventana de 24h).
    // sendWhatsAppTemplateMessage no soporta un payload/id personalizado por
    // botón, así que se hace match por el TEXTO exacto del botón — distinto
    // del patrón de texto libre "sí"/"no" (más abajo) porque el regex de ese
    // patrón exige que el mensaje sea SOLO esa palabra corta, y estos
    // botones tienen texto más largo ("Sí, asisto" / "No puedo").
    // Solo aplica a modo ESCALONADO (SIMPLE nunca pide confirmación).
    // ------------------------------------------------------------
    if (mensaje.type === 'button') {
      const textoBotonFicha = mensaje.button?.text || '';

      if (textoBotonFicha === 'Sí, asisto' || textoBotonFicha === 'No puedo') {
        const clienteFicha = await prisma.cliente.findFirst({
          where: { empresaId: empresa.id, telefono: telefonoCliente },
        });

        const atencionPendiente = clienteFicha
          ? await prisma.atencionClinica.findFirst({
              where: {
                clienteId: clienteFicha.id,
                recordatorioModo: 'ESCALONADO',
                OR: [
                  { recordatorioPaso1EnviadoEn: { not: null }, recordatorioPaso1Confirmado: null },
                  { recordatorioPaso2EnviadoEn: { not: null }, recordatorioPaso2Confirmado: null },
                ],
              },
              orderBy: { fechaProximaCitaFijada: 'asc' },
            })
          : null;

        if (atencionPendiente) {
          const respuestaSi = textoBotonFicha === 'Sí, asisto';
          // El paso2 siempre es la pregunta vigente más reciente si ya se
          // envió — una respuesta tardía al paso1 después de que el paso2
          // ya salió se cuenta como respuesta al paso2, no al paso1 (que
          // ya quedó superado por el segundo mensaje).
          const campo = (atencionPendiente.recordatorioPaso2EnviadoEn && atencionPendiente.recordatorioPaso2Confirmado === null)
            ? 'recordatorioPaso2Confirmado'
            : 'recordatorioPaso1Confirmado';

          await prisma.atencionClinica.update({
            where: { id: atencionPendiente.id },
            data: { [campo]: respuestaSi },
          });

          const accessTokenFicha = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
          if (accessTokenFicha) {
            await sendWhatsAppTextMessage({
              phoneNumberId, to: telefonoCliente, accessToken: accessTokenFicha,
              text: respuestaSi ? '¡Gracias por confirmar! Te esperamos ✅' : 'Entendido, gracias por avisar 🙌',
            });
          }

          console.log(`[FICHA] AtencionClinica ${atencionPendiente.id}: ${campo} = ${respuestaSi} (${empresa.nombre}).`);
        }

        return; // el texto del botón es inequívocamente de este flujo — no seguir a ningún otro, aunque no haya atención pendiente (respuesta tardía a un ciclo ya cerrado)
      }
    }
    // ---- fin bloque de confirmación de ficha clínica ----

    // ------------------------------------------------------------
    // "No por ahora" del recordatorio de control anual (ver
    // jobs/enviarRecordatorios.js). El botón "Agendar" de la misma
    // plantilla NO se intercepta acá a propósito: cualquier botón de
    // plantilla no atrapado antes cae solo como texto libre al flujo
    // normal de agendamiento (ver más abajo, "textoEntrante = mensaje.type
    // === 'button' ? ..."), así que "Agendar" ya funciona sin código extra.
    // ------------------------------------------------------------
    if (mensaje.type === 'button' && mensaje.button?.text === 'No por ahora') {
      const clienteRecordatorio = await prisma.cliente.findFirst({
        where: { empresaId: empresa.id, telefono: telefonoCliente },
      });

      if (clienteRecordatorio) {
        await prisma.cliente.update({
          where: { id: clienteRecordatorio.id },
          data: { recordatorioControlAnualConfirmado: false },
        });

        const accessTokenRecordatorio = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
        if (accessTokenRecordatorio) {
          await sendWhatsAppTextMessage({
            phoneNumberId, to: telefonoCliente, accessToken: accessTokenRecordatorio,
            text: 'Entendido, gracias por avisar 🙌',
          });
        }
      }

      return; // igual que el bloque de ficha -- no seguir a ningún otro flujo
    }
    // ---- fin bloque "No por ahora" del recordatorio de control anual ----

    // Rubros de catálogo rotativo (panadería, rotisería, etc.) usan un motor
    // de conversación distinto al de agendamiento — reacciona a botones y
    // listas interactivas, y envía sus propias respuestas.
    if (empresa.rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO') {
      await procesarMensajeCatalogoRotativo({ empresa, telefonoCliente, mensaje, nombreContacto });
      return;
    }

    // A partir de aquí, flujo normal de agendamiento (texto, botones, y las
    // listas interactivas que el propio bot ofrece: días, horarios, y
    // ahora también servicios).

    let textoEntrante;
    if (mensaje.type === 'interactive') {
      const listReplyId = mensaje.interactive?.list_reply?.id;

      // NUEVO: el cliente tocó un DÍA de la lista de "próximos días con
      // hora". Se resuelve sin pasar por Claude, igual que ya se hace con
      // la selección de una hora puntual — más rápido y determinístico.
      const diaElegido = decodificarFilaDia(listReplyId);
      if (diaElegido) {
        const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });
        if (!recurso) {
          return;
        }

        const horas = await obtenerHorariosDisponibles(recurso.id, diaElegido.fecha);
        const accessTokenDia = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

        if (!accessTokenDia) {
          console.error(`Empresa ${empresa.nombre} no tiene whatsappToken configurado y no hay WHATSAPP_ACCESS_TOKEN de respaldo.`);
          return;
        }

        if (horas.length === 0) {
          await sendWhatsAppTextMessage({
            phoneNumberId, to: telefonoCliente, accessToken: accessTokenDia,
            text: 'Ese día ya no tiene cupo disponible, ¿quieres que te muestre otro?',
          });
          return;
        }

        const fechaLegible = fechaLegibleDesdeISO(diaElegido.fecha);
        await sendWhatsAppInteractiveList({
          phoneNumberId, to: telefonoCliente, accessToken: accessTokenDia,
          textoCuerpo: `Estos son los horarios disponibles para el ${fechaLegible}. Elige el que más te acomode 👇`,
          textoBoton: 'Ver horarios',
          textoHeader: empresa.nombre?.slice(0, 60),
          filas: horas.map((hora) => ({ id: codificarFilaHorario(diaElegido.fecha, hora), titulo: hora })),
        });
        return;
      }

      // NUEVO: el cliente tocó un SERVICIO de la lista, o "Otro / no lo
      // encuentro". En ambos casos convertimos a texto y seguimos el flujo
      // normal de Claude — para "otro", el mensaje queda como una consulta
      // libre, sin forzarlo de vuelta a la lista.
      if (listReplyId === ID_FILA_SERVICIO_OTRO) {
        textoEntrante = 'No encuentro el servicio que necesito en la lista, tengo otra consulta.';
      } else {
        const servicioIdElegido = decodificarFilaServicio(listReplyId);
        if (servicioIdElegido) {
          const servicioElegido = await prisma.servicio.findUnique({ where: { id: servicioIdElegido } });
          textoEntrante = servicioElegido
            ? `Quiero agendar el servicio "${servicioElegido.nombre}".`
            : 'Ese servicio ya no está disponible, ¿me puedes decir cuál necesitas?';
        } else {
          // Único otro tipo interactivo que este flujo entiende: el cliente
          // tocó un horario de la lista que le mostramos (ver claude.js).
          // Cualquier otro id (ej. de una lista de otro flujo) se ignora
          // silenciosamente.
          const horarioElegido = decodificarFilaHorario(listReplyId);
          if (!horarioElegido) {
            return;
          }
          // Se incluye la fecha ya en español (no solo el ISO crudo) para
          // que el modelo, al redactar la confirmación final, no tenga que
          // calcular él mismo qué día de la semana es esa fecha — eso puede
          // salir mal (Ahorróptica reportó una confirmación real que decía
          // "sábado 12 de septiembre" para una cita agendada un viernes).
          textoEntrante = `Confirmo que quiero agendar para el ${fechaLegibleDesdeISO(horarioElegido.fecha)} (${horarioElegido.fecha}) a las ${horarioElegido.hora}.`;
        }
      }
    } else {
      textoEntrante = mensaje.type === 'button'
        ? (mensaje.button?.text || '')
        : (mensaje.text?.body || '');
    }

    // ------------------------------------------------------------
    // Si el cliente tiene una cita PENDIENTE esperando confirmación
    // (ver src/jobs/confirmarCitasProximas.js), interpretamos un "sí"/"no"
    // corto como respuesta a esa confirmación, antes que nada — sin pasar
    // por Claude. Si el mensaje no calza con ninguno de los dos patrones,
    // seguimos al flujo normal (puede ser otra cosa, ej. "puedo cambiar la
    // hora?").
    if (mensaje.type === 'text' || mensaje.type === 'button') {
      const pareceConfirmar = /^\s*(s[ií]|confirmo|confirmar|dale|ok|listo|correcto)\s*[.!]?\s*$/i.test(textoEntrante);
      const pareceCancelar = /^\s*no(\s+puedo|\s+podr[eé])?\s*[.!]?\s*$|^\s*(cancelar|anular)\s*[.!]?\s*$/i.test(textoEntrante);

      if (pareceConfirmar || pareceCancelar) {
        const clienteExistente = await prisma.cliente.findFirst({
          where: { empresaId: empresa.id, telefono: telefonoCliente },
        });

        const citaPendiente = clienteExistente
          ? await prisma.cita.findFirst({
              where: { empresaId: empresa.id, clienteId: clienteExistente.id, estado: 'PENDIENTE', confirmacionIntentos: { gt: 0 } },
              orderBy: { fechaHoraInicio: 'asc' },
            })
          : null;

        if (citaPendiente) {
          const accessTokenCita = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

          if (pareceConfirmar) {
            await prisma.cita.update({ where: { id: citaPendiente.id }, data: { estado: 'CONFIRMADA' } });
            await sendWhatsAppTextMessage({
              phoneNumberId, to: telefonoCliente, accessToken: accessTokenCita,
              text: '¡Gracias por confirmar! Tu cita queda lista ✅',
            });
          } else {
            await prisma.cita.update({ where: { id: citaPendiente.id }, data: { estado: 'CANCELADA', canceladaPorNoConfirmar: false } });
            await sendWhatsAppTextMessage({
              phoneNumberId, to: telefonoCliente, accessToken: accessTokenCita,
              text: 'Entendido, cancelamos tu cita. Escríbenos cuando quieras agendar otra 🙌',
            });
          }

          console.log(`Cita ${citaPendiente.id} ${pareceConfirmar ? 'confirmada' : 'cancelada'} por respuesta de texto (${empresa.nombre}).`);
          return; // ya respondimos, no seguir al flujo normal de Claude
        }
      }
    }
    // ---- fin bloque de confirmación de citas ----

    const { respuestaTexto, interactivo } = await procesarMensajeEntrante({
      empresa,
      telefonoCliente,
      textoEntrante,
      nombreContacto,
    });

    // Coexistence: conversación pausada por intervención humana — no se
    // envía nada por WhatsApp este turno (ver chatbotEngine.js).
    if (respuestaTexto === null) {
      return;
    }

    // Enviar la respuesta por WhatsApp
    const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(`Empresa ${empresa.nombre} no tiene whatsappToken configurado y no hay WHATSAPP_ACCESS_TOKEN de respaldo.`);
      return;
    }

    if (interactivo?.tipo === 'lista_dias') {
      await sendWhatsAppInteractiveList({
        phoneNumberId,
        to: telefonoCliente,
        accessToken,
        textoCuerpo: respuestaTexto,
        textoBoton: 'Ver días',
        textoHeader: empresa.nombre?.slice(0, 60),
        secciones: [{
          titulo: 'Próximos días con hora',
          filas: interactivo.dias.map((d) => ({
            id: codificarFilaDia(d.fecha),
            titulo: fechaLegibleDesdeISO(d.fecha),
          })),
        }],
      });
    } else if (interactivo?.tipo === 'lista_horarios') {
      await sendWhatsAppInteractiveList({
        phoneNumberId,
        to: telefonoCliente,
        accessToken,
        textoCuerpo: respuestaTexto,
        textoBoton: 'Ver horarios',
        textoHeader: empresa.nombre?.slice(0, 60),
        filas: interactivo.horas.map((hora) => ({
          id: codificarFilaHorario(interactivo.fecha, hora),
          titulo: hora,
        })),
      });
    } else if (interactivo?.tipo === 'horarios_por_bloque') {
      // Demasiadas horas para una lista interactiva (o hay más de un bloque
      // real, ej. mañana/tarde separados por un break) — un mensaje de
      // texto plano por bloque en vez de un solo texto largo o una lista
      // truncada a 10. Pedido por Ahorróptica 2026-09-03.
      for (const bloque of interactivo.bloques) {
        const textoBloque = `Estos son los horarios disponibles en ${bloque.etiqueta} para el ${fechaLegibleDesdeISO(interactivo.fecha)}: ${bloque.horas.join(', ')}.`;
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: telefonoCliente,
          text: textoBloque,
          accessToken,
        });
      }
      await sendWhatsAppTextMessage({
        phoneNumberId,
        to: telefonoCliente,
        text: '¿Cuál te acomoda? Escríbeme la hora que prefieras.',
        accessToken,
      });
    } else if (interactivo?.tipo === 'catalogo_imagenes') {
      // Máximo 4 imágenes por respuesta (ya viene acotado desde claude.js).
      // Se manda primero el texto y luego cada imagen por separado — la API
      // de WhatsApp no soporta un mensaje con múltiples imágenes en uno solo.
      await sendWhatsAppTextMessage({
        phoneNumberId,
        to: telefonoCliente,
        text: respuestaTexto,
        accessToken,
      });
      for (const item of interactivo.items) {
        await sendWhatsAppImageMessage({
          phoneNumberId,
          to: telefonoCliente,
          accessToken,
          imageUrl: item.imagenUrl,
          caption: item.nombre,
        });
      }
    } else if (interactivo?.tipo === 'lista_servicios') {
      await sendWhatsAppInteractiveList({
        phoneNumberId,
        to: telefonoCliente,
        accessToken,
        textoCuerpo: respuestaTexto,
        textoBoton: 'Ver servicios',
        textoHeader: empresa.nombre?.slice(0, 60),
        filas: [
          ...interactivo.servicios.map((s) => ({ id: codificarFilaServicio(s.id), titulo: s.nombre })),
          { id: ID_FILA_SERVICIO_OTRO, titulo: 'Otro / no lo encuentro', descripcion: 'Cuéntame qué necesitas' },
        ],
      });
    } else {
      await sendWhatsAppTextMessage({
        phoneNumberId,
        to: telefonoCliente,
        text: respuestaTexto,
        accessToken,
      });
    }

    console.log(`Respondido a ${telefonoCliente} (${empresa.nombre}): "${respuestaTexto}"`);
  } catch (error) {
    console.error('Error procesando mensaje entrante de WhatsApp:', error);
  }
});

// ------------------------------------------------------------
// WEBHOOK DE INSTAGRAM DIRECT — recepción de mensajes entrantes. Canal nuevo
// (2026-09-08), arquitectura general pero habilitado y visible solo para
// LuxVision (ver EMPRESA_ID_LUXVISION más arriba). Handler separado del de
// WhatsApp (no comparte su cadena de interceptores de botones/listas
// interactivas de arriba) porque el payload de Instagram es distinto y no
// tiene listas nativas — cualquier `interactivo` se aplana a texto plano
// con armarTextoConInteractivo (ver src/services/instagram.js). Reusa el
// mismo motor de IA (procesarMensajeEntrante) que WhatsApp sin cambios.
// ------------------------------------------------------------
app.post('/webhook/instagram', verificarFirmaWebhookInstagram, async (req, res) => {
  // Igual que WhatsApp: respondemos 200 de inmediato, Meta espera <5s.
  res.sendStatus(200);

  try {
    if (req.body.object !== 'instagram') return;

    const entry = req.body.entry?.[0];
    // entry.id = id de la cuenta de Instagram que recibió el webhook (la
    // cuenta del negocio) — se usa para resolver el tenant, igual que
    // phone_number_id en WhatsApp. Ver instagramCuentaId en el schema.
    const igCuentaId = entry?.id;
    const evento = entry?.messaging?.[0];

    if (!igCuentaId || !evento) return;

    const empresa = await prisma.empresa.findFirst({
      where: { instagramCuentaId: igCuentaId },
    });

    if (!empresa) {
      console.warn(`No se encontró ninguna Empresa para instagramCuentaId=${igCuentaId}`);
      return;
    }

    // Guardia: el canal existe en el código para cualquier empresa, pero
    // por ahora solo hace algo para LuxVision (ver contexto del plan).
    if (empresa.id !== EMPRESA_ID_LUXVISION) {
      return;
    }

    const igsidCliente = evento.sender?.id;
    if (!igsidCliente) return;

    // Echo: un humano respondió manualmente desde la app de Instagram (o
    // desde el panel de Meta Business Suite) — mismo mecanismo de pausa que
    // Coexistence en WhatsApp (ver bloque smb_message_echoes más arriba),
    // pero con el campo propio de Instagram (`message.is_echo`).
    //
    // TODO-VERIFICAR-CON-CASO-REAL: escrito contra la documentación de Meta
    // (Instagram Messaging API / Send & Receive), nunca probado contra un
    // caso real (bloqueado por Advanced Access, ver plan). Confirmar el
    // shape exacto del payload apenas haya un primer mensaje real.
    if (evento.message?.is_echo) {
      const conversacionEco = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: igsidCliente, canal: 'instagram' },
      });

      if (conversacionEco) {
        await prisma.conversacion.update({
          where: { id: conversacionEco.id },
          data: { pausadaPorHumanoEn: new Date() },
        });
      } else {
        await prisma.conversacion.create({
          data: {
            empresaId: empresa.id,
            telefono: igsidCliente,
            canal: 'instagram',
            mensajes: [],
            pausadaPorHumanoEn: new Date(),
          },
        });
      }

      console.log(`[INSTAGRAM] Echo detectado — bot pausado para ${igsidCliente} (${empresa.nombre}).`);
      return;
    }

    const textoEntrante = evento.message?.text;
    if (!textoEntrante) return; // ignoramos silenciosamente adjuntos, reacciones, etc.

    const { respuestaTexto, interactivo } = await procesarMensajeEntrante({
      empresa,
      telefonoCliente: igsidCliente,
      textoEntrante,
      nombreContacto: null,
      canal: 'instagram',
    });

    // Coexistence: conversación pausada por intervención humana — no se
    // envía nada este turno (ver chatbotEngine.js).
    if (respuestaTexto === null) {
      return;
    }

    if (!empresa.instagramToken) {
      console.error(`Empresa ${empresa.nombre} no tiene instagramToken configurado.`);
      return;
    }

    await sendInstagramTextMessage({
      igCuentaId,
      to: igsidCliente,
      text: armarTextoConInteractivo(respuestaTexto, interactivo),
      accessToken: empresa.instagramToken,
    });

    console.log(`[INSTAGRAM] Respondido a ${igsidCliente} (${empresa.nombre}): "${respuestaTexto}"`);
  } catch (error) {
    console.error('Error procesando mensaje entrante de Instagram:', error);
  }
});

// ------------------------------------------------------------
// WEBHOOK DE MESSENGER (Facebook) — recepción de mensajes entrantes. Canal
// nuevo (2026-09-09), mismo patrón que Instagram arriba: handler separado,
// arquitectura general pero habilitado y visible solo para LuxVision (ver
// EMPRESA_ID_LUXVISION). Mismo aplanado de `interactivo` a texto plano
// (ver src/services/facebook.js) y mismo motor de IA sin cambios.
// ------------------------------------------------------------
app.post('/webhook/facebook', verificarFirmaWebhookFacebook, async (req, res) => {
  // Igual que Instagram/WhatsApp: respondemos 200 de inmediato.
  res.sendStatus(200);

  try {
    if (req.body.object !== 'page') return;

    const entry = req.body.entry?.[0];
    // entry.id = id de la Página de Facebook que recibió el webhook — se
    // usa para resolver el tenant, igual que instagramCuentaId en el
    // webhook de Instagram. Ver facebookPaginaId en el schema.
    const paginaId = entry?.id;
    const evento = entry?.messaging?.[0];

    if (!paginaId || !evento) return;

    const empresa = await prisma.empresa.findFirst({
      where: { facebookPaginaId: paginaId },
    });

    if (!empresa) {
      console.warn(`No se encontró ninguna Empresa para facebookPaginaId=${paginaId}`);
      return;
    }

    // Guardia: el canal existe en el código para cualquier empresa, pero
    // por ahora solo hace algo para LuxVision.
    if (empresa.id !== EMPRESA_ID_LUXVISION) {
      return;
    }

    const psidCliente = evento.sender?.id;
    if (!psidCliente) return;

    // Echo: un humano respondió manualmente desde la Bandeja de entrada de
    // Meta Business Suite o la app de Messenger — mismo mecanismo de pausa
    // que Instagram/Coexistence, mismo campo `message.is_echo`. Confirmado
    // contra un caso real ayer con Instagram (mismo payload shape en la
    // familia Messenger Platform) — pero ojo: como con Instagram, la
    // "Respuesta instantánea" nativa de Meta Business Suite también
    // dispara un echo y pausaría el bot si sigue activada para esta
    // Página — desactivarla antes de la primera prueba real.
    if (evento.message?.is_echo) {
      const conversacionEco = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: psidCliente, canal: 'facebook' },
      });

      if (conversacionEco) {
        await prisma.conversacion.update({
          where: { id: conversacionEco.id },
          data: { pausadaPorHumanoEn: new Date() },
        });
      } else {
        await prisma.conversacion.create({
          data: {
            empresaId: empresa.id,
            telefono: psidCliente,
            canal: 'facebook',
            mensajes: [],
            pausadaPorHumanoEn: new Date(),
          },
        });
      }

      console.log(`[FACEBOOK] Echo detectado — bot pausado para ${psidCliente} (${empresa.nombre}).`);
      return;
    }

    const textoEntrante = evento.message?.text;
    if (!textoEntrante) return; // ignoramos silenciosamente adjuntos, reacciones, etc.

    const { respuestaTexto, interactivo } = await procesarMensajeEntrante({
      empresa,
      telefonoCliente: psidCliente,
      textoEntrante,
      nombreContacto: null,
      canal: 'facebook',
    });

    // Coexistence: conversación pausada por intervención humana — no se
    // envía nada este turno (ver chatbotEngine.js).
    if (respuestaTexto === null) {
      return;
    }

    if (!empresa.facebookToken) {
      console.error(`Empresa ${empresa.nombre} no tiene facebookToken configurado.`);
      return;
    }

    await sendFacebookTextMessage({
      paginaId,
      to: psidCliente,
      text: armarTextoConInteractivoFacebook(respuestaTexto, interactivo),
      accessToken: empresa.facebookToken,
    });

    console.log(`[FACEBOOK] Respondido a ${psidCliente} (${empresa.nombre}): "${respuestaTexto}"`);
  } catch (error) {
    console.error('Error procesando mensaje entrante de Messenger:', error);
  }
});

// ------------------------------------------------------------
// CONTRATO DE ACEPTACIÓN (clickwrap) — el cliente elige plan y acepta
// ------------------------------------------------------------
app.get('/contrato/:empresaId', async (req, res) => {
  const empresa = await prisma.empresa.findUnique({ where: { id: req.params.empresaId } });

  if (!empresa) {
    return res.status(404).send('Empresa no encontrada');
  }

  res.send(renderFormulario(empresa));
});

// ------------------------------------------------------------
// DEMO DEL PANEL DE ADMINISTRACIÓN — página estática enviada como link
// desde la demo comercial (ver src/services/demoEngine.js).
// ------------------------------------------------------------
app.get('/demo/panel', (req, res) => {
  res.send(renderPanelDemo());
});

app.post('/contrato/:empresaId/aceptar', async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: req.params.empresaId } });
    if (!empresa) {
      return res.status(404).send('Empresa no encontrada');
    }

    const { plan, nombreQuienAcepta, emailQuienAcepta, aceptoTerminos, aceptoDatosPacientes } = req.body;
    const planInfo = PLANES[plan];

    if (!planInfo) {
      return res.status(400).send('Plan inválido');
    }

    const hoy = new Date();
    const proximoCobroHosting = new Date(hoy);
    proximoCobroHosting.setFullYear(proximoCobroHosting.getFullYear() + 1);

    // Registrar/actualizar la Suscripcion con el plan elegido
    await prisma.suscripcion.upsert({
      where: { empresaId: empresa.id },
      update: {
        plan,
        montoMensualActual: planInfo.montoMensual,
        citasIncluidas: planInfo.citasIncluidas,
        precioCitaExcedente: planInfo.precioCitaExcedente,
      },
      create: {
        empresaId: empresa.id,
        plan,
        estado: 'PENDIENTE_PAGO',
        montoMensualActual: planInfo.montoMensual,
        citasIncluidas: planInfo.citasIncluidas,
        precioCitaExcedente: planInfo.precioCitaExcedente,
        fechaProximoCobro: hoy,
        fechaProximoCobroHosting: proximoCobroHosting,
      },
    });

    // Dejar registro legal de la aceptación (clickwrap)
    await prisma.contratoAceptado.create({
      data: {
        empresaId: empresa.id,
        versionContrato: 'grilla-abc-v1',
        aceptoTerminos: aceptoTerminos === 'true',
        aceptoDatosPacientes: aceptoDatosPacientes === 'true',
        nombreQuienAcepta,
        emailQuienAcepta,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      ok: true,
      empresaNombre: empresa.nombre,
      plan,
      planLabel: planInfo.etiqueta,
    });
  } catch (error) {
    console.error('Error al aceptar contrato:', error);
    res.status(500).send('Ocurrió un error al procesar la aceptación. Por favor intenta de nuevo.');
  }
});

// ------------------------------------------------------------
// MINI-SITIO AUTOGENERADO POR NEGOCIO — funcionalidad adicional de
// Totemsystem, sin depender de ninguna plataforma externa. Se arma 100%
// con datos que el negocio ya carga en el panel.
// ------------------------------------------------------------
app.get('/sitio/:empresaId', async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.params.empresaId },
      include: { rubroTemplate: true },
    });

    if (!empresa) {
      return res.status(404).send('Negocio no encontrado');
    }

    const esAgendamiento = empresa.rubroTemplate.modoOperacion === 'AGENDAMIENTO';

    const servicios = esAgendamiento
      ? await prisma.servicio.findMany({ where: { empresaId: empresa.id, activo: true }, orderBy: { nombre: 'asc' } })
      : [];

    const productos = !esAgendamiento
      ? await prisma.producto.findMany({ where: { empresaId: empresa.id, activo: true }, orderBy: { nombre: 'asc' }, take: 8 })
      : [];

    res.send(renderSitioNegocio({ empresa, servicios, productos, esAgendamiento }));
  } catch (error) {
    console.error('Error en GET /sitio/:empresaId:', error);
    res.status(500).send('Ocurrió un error al cargar la página.');
  }
});



// ------------------------------------------------------------
// ENDPOINT DE PRUEBA — simula una conversación SIN pasar por WhatsApp.
// Útil para probar disponibilidad/agendamiento con tenants (ej. LuxVision)
// que todavía no tienen número de WhatsApp conectado a esta app.
//
// Protegido con un secreto compartido simple (no JWT de usuario), porque
// esto no representa a NINGÚN usuario real del panel — es una herramienta
// de pruebas interna que simula clientes de CUALQUIER empresa a la vez.
// Si TEST_ENDPOINT_SECRET no está configurado, el endpoint queda cerrado
// por completo (fail-closed) en vez de quedar abierto por accidente.
// ------------------------------------------------------------

function requireTestSecret(req, res, next) {
  const secretoEsperado = process.env.TEST_ENDPOINT_SECRET;
  if (!secretoEsperado) {
    return res.status(503).json({ error: '/test/chat está deshabilitado (falta configurar TEST_ENDPOINT_SECRET)' });
  }

  const secretoRecibido = req.header('x-test-secret') || '';
  const bufEsperado = Buffer.from(secretoEsperado);
  const bufRecibido = Buffer.from(secretoRecibido);

  // timingSafeEqual exige buffers del mismo largo — si no calzan, ya sabemos
  // que no son iguales, sin arriesgarnos a comparar buffers de largo distinto.
  const coincide =
    bufEsperado.length === bufRecibido.length && crypto.timingSafeEqual(bufEsperado, bufRecibido);

  if (!coincide) {
    return res.status(401).json({ error: 'Secreto de prueba inválido o faltante (header x-test-secret)' });
  }

  next();
}

app.post('/test/chat', requireTestSecret, async (req, res) => {
  try {
    const { empresaId, telefono, mensaje } = req.body;

    if (!empresaId || !telefono || !mensaje) {
      return res.status(400).json({ error: 'Faltan campos: empresaId, telefono, mensaje' });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { rubroTemplate: true },
    });

    if (!empresa) {
      return res.status(404).json({ error: `Empresa ${empresaId} no existe` });
    }

    const { respuestaTexto, interactivo } = await procesarMensajeEntrante({
      empresa,
      telefonoCliente: telefono,
      textoEntrante: mensaje,
      nombreContacto: 'Cliente de prueba',
    });

    res.json({ respuesta: respuestaTexto, interactivo });
  } catch (error) {
    console.error('Error en /test/chat:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgendaBot backend escuchando en el puerto ${PORT}`);
});