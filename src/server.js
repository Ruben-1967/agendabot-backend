require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
app.post('/webhook/whatsapp', (req, res) => {
  console.log('Mensaje entrante de WhatsApp:', JSON.stringify(req.body, null, 2));
  // TODO: identificar empresa por whatsappNumeroId, buscar/crear Conversacion,
  // enviar a Claude Haiku y responder vía WhatsApp Cloud API.
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgendaBot backend escuchando en el puerto ${PORT}`);
});
