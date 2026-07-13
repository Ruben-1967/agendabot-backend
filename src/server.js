require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { sendWhatsAppTextMessage } = require('./services/whatsapp');
const { generarRespuestaChatbot } = require('./services/claude');

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

    // 1. Identificar a qué empresa (tenant) pertenece este número de WhatsApp
    const empresa = await prisma.empresa.findFirst({
      where: { whatsappNumeroId: phoneNumberId },
      include: { rubroTemplate: true },
    });

    if (!empresa) {
      console.warn(`No se encontró ninguna Empresa para phone_number_id=${phoneNumberId}`);
      return;
    }

    // 2. Buscar o crear el Cliente por teléfono dentro de esa empresa
    let cliente = await prisma.cliente.findFirst({
      where: { empresaId: empresa.id, telefono: telefonoCliente },
    });

    if (!cliente) {
      cliente = await prisma.cliente.create({
        data: {
          empresaId: empresa.id,
          telefono: telefonoCliente,
          nombre: nombreContacto || 'Sin nombre',
        },
      });
    }

    // 3. Buscar o crear la Conversacion activa con este cliente
    let conversacion = await prisma.conversacion.findFirst({
      where: { empresaId: empresa.id, telefono: telefonoCliente },
    });

    const historialPrevio = conversacion?.mensajes || [];

    // 4. Generar la respuesta con Claude, usando el historial guardado
    const respuestaTexto = await generarRespuestaChatbot({
      empresa,
      historial: historialPrevio,
      mensajeEntrante: textoEntrante,
    });

    // 5. Enviar la respuesta por WhatsApp
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

    // 6. Guardar el intercambio (mensaje entrante + respuesta) en la Conversacion
    const mensajesActualizados = [
      ...historialPrevio,
      { rol: 'usuario', contenido: textoEntrante, timestamp: new Date().toISOString() },
      { rol: 'asistente', contenido: respuestaTexto, timestamp: new Date().toISOString() },
    ];

    await prisma.conversacion.upsert({
      where: { id: conversacion?.id || '00000000-0000-0000-0000-000000000000' },
      update: { mensajes: mensajesActualizados, clienteId: cliente.id },
      create: {
        empresaId: empresa.id,
        clienteId: cliente.id,
        telefono: telefonoCliente,
        mensajes: mensajesActualizados,
      },
    });

    console.log(`Respondido a ${telefonoCliente} (${empresa.nombre}): "${respuestaTexto}"`);
  } catch (error) {
    console.error('Error procesando mensaje entrante de WhatsApp:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgendaBot backend escuchando en el puerto ${PORT}`);
});
