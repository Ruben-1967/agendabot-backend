require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { sendWhatsAppTextMessage } = require('./services/whatsapp');
const { procesarMensajeEntrante } = require('./services/chatbotEngine');

const app = express();
app.use(cors());
app.use(express.json());

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

    // Ignoramos silenciosamente eventos que no son mensajes de texto entrantes
    // (ej. confirmaciones de entrega/lectura, cambios de estado de cuenta, etc.)
    if (!mensaje || mensaje.type !== 'text') {
      return;
    }

    const phoneNumberId = value.metadata?.phone_number_id;
    const telefonoCliente = mensaje.from; // ej. "56912345678"
    const textoEntrante = mensaje.text?.body || '';
    const nombreContacto = value.contacts?.[0]?.profile?.name || null;

    // Identificar a qué empresa (tenant) pertenece este número de WhatsApp
    const empresa = await prisma.empresa.findFirst({
      where: { whatsappNumeroId: phoneNumberId },
      include: { rubroTemplate: true },
    });

    if (!empresa) {
      console.warn(`No se encontró ninguna Empresa para phone_number_id=${phoneNumberId}`);
      return;
    }

    const { respuestaTexto } = await procesarMensajeEntrante({
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

    await sendWhatsAppTextMessage({
      phoneNumberId,
      to: telefonoCliente,
      text: respuestaTexto,
      accessToken,
    });

    console.log(`Respondido a ${telefonoCliente} (${empresa.nombre}): "${respuestaTexto}"`);
  } catch (error) {
    console.error('Error procesando mensaje entrante de WhatsApp:', error);
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

    const { respuestaTexto } = await procesarMensajeEntrante({
      empresa,
      telefonoCliente: telefono,
      textoEntrante: mensaje,
      nombreContacto: 'Cliente de prueba',
    });

    res.json({ respuesta: respuestaTexto });
  } catch (error) {
    console.error('Error en /test/chat:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgendaBot backend escuchando en el puerto ${PORT}`);
});
