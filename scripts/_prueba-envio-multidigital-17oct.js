#!/usr/bin/env node
// Uso puntual (2026-10-17): los mensajes entrantes al +56 9 6610 8858 no llegan al servidor y
// todos los destinos de webhook están bien configurados. Esta prueba manda UN mensaje de
// texto DESDE ese número hacia el teléfono de prueba fijo del dueño (+56 9 8408 4321) y
// muestra la respuesta cruda de Meta. El error devuelto distingue las causas:
//   133010 = el número NO está registrado en Cloud API (falta el /register)
//   141006 / 131042 = falta método de pago en la cuenta de WhatsApp
//   131047 = fuera de la ventana de 24 h (texto libre no permitido) -- el número SÍ funciona
// Usa el token guardado en la Empresa Multidigital (nunca se imprime). Un solo mensaje, un
// solo destinatario fijo.
//
// USO (Shell de Render, producción):
//   node scripts/_prueba-envio-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const DESTINO = '56984084321'; // teléfono de prueba fijo del dueño
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre) || !e.whatsappToken || !e.whatsappNumeroId) {
    throw new Error('Falta la Empresa Multidigital con WhatsApp guardado.');
  }
  console.log(`Enviando UN mensaje de prueba desde ${e.whatsappPhoneNumber} a ${DESTINO}...`);
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${e.whatsappNumeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.whatsappToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: DESTINO,
      type: 'text',
      text: { body: 'Prueba técnica de Multidigital: si lees esto, el número puede enviar mensajes.' },
    }),
  });
  const data = await res.json();
  console.log(`HTTP ${res.status}:`, limpiar(JSON.stringify(data)));
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
