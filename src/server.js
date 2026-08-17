require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const crypto = require('crypto');
const {
  sendWhatsAppTextMessage,
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
const { renderFormulario, PLANES } = require('./services/contratoHtml');
const authRouter = require('./routes/auth');
const campanasRouter = require('./routes/campanas');
const productosRouter = require('./routes/productos');
const pedidosRouter = require('./routes/pedidos');
const clientesRouter = require('./routes/clientes');
const billeteraRouter = require('./routes/billetera');
const empresaRouter = require('./routes/empresa');
const agendaRouter = require('./routes/agenda');
const serviciosRouter = require('./routes/servicios');
const { procesarMensajeCatalogoRotativo } = require('./services/pedidosEngine');
const { procesarMensajeDemo } = require('./services/demoEngine');
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
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Middleware CORS con soporte para múltiples orígenes
app.use((req, res, next) => {
  const origenPermitido = process.env.PANEL_FRONTEND_URL || 'https://agendabot-beryl.vercel.app';
  const origenesPermitidos = origenPermitido.split(',').map(o => o.trim());
  
  const origen = req.get('origin');
  
  if (origenesPermitidos.includes(origen) || origenesPermitidos.includes('*')) {
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

app.use('/auth', authRouter);
app.use('/campanas', campanasRouter);
app.use('/productos', productosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/clientes', clientesRouter);
app.use('/billetera', billeteraRouter);
app.use('/empresa', empresaRouter);
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
            await sendWhatsAppTextMessage({
              phoneNumberId, to: telefonoCliente, accessToken: accessTokenDemo,
              text: 'Ese día ya no tiene cupo disponible, ¿quieres que te muestre otro?',
            });
            return;
          }
          const fechaLegibleDemo = fechaLegibleDesdeISO(diaElegidoDemo.fecha);
          await sendWhatsAppInteractiveList({
            phoneNumberId, to: telefonoCliente, accessToken: accessTokenDemo,
            textoCuerpo: `Estos son los horarios disponibles para el ${fechaLegibleDemo}. Elige el que más te acomode 👇`,
            textoBoton: 'Ver horarios',
            textoHeader: demoAsignada.empresaDemo.nombre?.slice(0, 60),
            filas: horasDemo.map((hora) => ({ id: codificarFilaHorario(diaElegidoDemo.fecha, hora), titulo: hora })),
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
              descripcion: `Desde las ${d.primeraHora}`,
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
          textoEntrante = `Confirmo que quiero agendar para el ${horarioElegido.fecha} a las ${horarioElegido.hora}.`;
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
            descripcion: `Desde las ${d.primeraHora}`,
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