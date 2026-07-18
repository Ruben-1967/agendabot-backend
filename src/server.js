require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const {
  sendWhatsAppTextMessage,
  sendWhatsAppInteractiveList,
  decodificarFilaHorario,
  codificarFilaHorario,
} = require('./services/whatsapp');
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

const app = express();

// En desarrollo, si PANEL_FRONTEND_URL no está definida, se permite cualquier
// origen para no bloquear pruebas locales. En producción, definir esa env var
// con la URL real del Static Site del panel (ej. https://agendabot-panel.onrender.com)
const origenesPermitidos = process.env.PANEL_FRONTEND_URL
  ? process.env.PANEL_FRONTEND_URL.split(',').map((s) => s.trim())
  : true;

app.use(cors({ origin: origenesPermitidos }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRouter);
app.use('/campanas', campanasRouter);
app.use('/productos', productosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/clientes', clientesRouter);
app.use('/billetera', billeteraRouter);
app.use('/empresa', empresaRouter);
app.use('/agenda', agendaRouter);
app.use('/servicios', serviciosRouter);


app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'AgendaBot backend' });
});

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
app.post('/webhook/whatsapp', async (req, res) => {
  // Respondemos 200 de inmediato: Meta espera una respuesta rápida (<5s)
  // y reintenta / desactiva el webhook si tarda demasiado o falla seguido.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];

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
      const demoAsignada = await prisma.demoAsignada.findUnique({
        where: { telefono: telefonoCliente },
        include: { empresaDemo: { include: { rubroTemplate: true } } },
      });

      const accessTokenDemo = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

      if (!demoAsignada) {
        // Nadie asignó este teléfono a ninguna demo todavía
        await sendWhatsAppTextMessage({
          phoneNumberId,
          to: telefonoCliente,
          text: 'Este número es para demos coordinadas con nuestro equipo. Escríbenos a contacto@multidigital.cl para agendar tu demo personalizada 🙌',
          accessToken: accessTokenDemo,
        });
        return;
      }

      const { respuestaTexto, interactivo } = await procesarMensajeDemo({
        demoAsignada,
        telefonoCliente,
        mensaje,
        nombreContacto,
      });

      if (interactivo?.tipo === 'lista_horarios') {
        await sendWhatsAppInteractiveList({
          phoneNumberId,
          to: telefonoCliente,
          accessToken: accessTokenDemo,
          textoCuerpo: respuestaTexto,
          textoBoton: 'Ver horarios',
          filas: interactivo.horas.map((hora) => ({
            id: codificarFilaHorario(interactivo.fecha, hora),
            titulo: hora,
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

    // Rubros de catálogo rotativo (panadería, rotisería, etc.) usan un motor
    // de conversación distinto al de agendamiento — reacciona a botones y
    // listas interactivas, y envía sus propias respuestas.
    if (empresa.rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO') {
      await procesarMensajeCatalogoRotativo({ empresa, telefonoCliente, mensaje, nombreContacto });
      return;
    }

    // A partir de aquí, flujo normal de agendamiento (texto, botones, y la
    // lista interactiva de horarios que el propio bot ofrece).
    
    let textoEntrante;
    if (mensaje.type === 'interactive') {
      // Único tipo interactivo que este flujo entiende: el cliente tocó un
      // horario de la lista que le mostramos (ver claude.js). Cualquier otro
      // id (ej. de una lista de otro flujo) se ignora silenciosamente.
      const listReplyId = mensaje.interactive?.list_reply?.id;
      const horarioElegido = decodificarFilaHorario(listReplyId);
      if (!horarioElegido) {
        return;
      }
      textoEntrante = `Confirmo que quiero agendar para el ${horarioElegido.fecha} a las ${horarioElegido.hora}.`;
    } else {
      textoEntrante = mensaje.type === 'button'
        ? (mensaje.button?.text || '')
        : (mensaje.text?.body || '');
    }

    // ------------------------------------------------------------
    // NUEVO: si el cliente tiene una cita PENDIENTE esperando confirmación
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

    if (interactivo?.tipo === 'lista_horarios') {
      await sendWhatsAppInteractiveList({
        phoneNumberId,
        to: telefonoCliente,
        accessToken,
        textoCuerpo: respuestaTexto,
        textoBoton: 'Ver horarios',
        filas: interactivo.horas.map((hora) => ({
          id: codificarFilaHorario(interactivo.fecha, hora),
          titulo: hora,
        })),
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
// ENDPOINT DE PRUEBA — simula una conversación SIN pasar por WhatsApp.
// Útil para probar disponibilidad/agendamiento con tenants (ej. LuxVision)
// que todavía no tienen número de WhatsApp conectado a esta app.
//
// NOTA: este endpoint no tiene autenticación — es solo para pruebas
// internas durante el desarrollo. Debe eliminarse o protegerse antes
// de considerar el backend listo para producción real.
// ------------------------------------------------------------
app.post('/test/chat', async (req, res) => {
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