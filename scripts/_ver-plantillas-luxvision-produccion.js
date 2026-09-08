#!/usr/bin/env node
// Uso puntual: lista las plantillas de WhatsApp de la WABA real de
// LuxVision ("Totemsystem Producción"), usando el whatsappToken ya
// guardado en su Empresa (se descifra solo, ver src/lib/prisma.js) en vez
// de depender de WHATSAPP_ACCESS_TOKEN/WHATSAPP_WABA_ID (no configuradas
// en el entorno de producción). Solo lectura, no manda nada.
//
// USO (Shell de Render, backend de producción):
//   node scripts/_ver-plantillas-luxvision-produccion.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const WABA_ID_ESPERADO = '2156101751629995'; // "Totemsystem Producción", confirmado en Meta Business Suite
const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID_LUXVISION },
    select: { nombre: true, whatsappToken: true, whatsappWabaId: true, whatsappNumeroId: true },
  });

  if (!empresa) throw new Error('No se encontró la Empresa de LuxVision');
  if (!empresa.whatsappToken) throw new Error('LuxVision no tiene whatsappToken guardado');
  if (!empresa.whatsappWabaId) throw new Error('LuxVision no tiene whatsappWabaId guardado');

  if (empresa.whatsappWabaId !== WABA_ID_ESPERADO) {
    console.warn(
      `⚠️  El whatsappWabaId guardado (${empresa.whatsappWabaId}) no coincide con el esperado ` +
      `(${WABA_ID_ESPERADO}, "Totemsystem Producción") — revisar antes de seguir.`
    );
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates?fields=name,status,category,language&limit=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${empresa.whatsappToken}` },
  });
  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const plantillas = data.data || [];
  console.log(`\nEmpresa: ${empresa.nombre} — WABA: ${empresa.whatsappWabaId}`);
  console.log(`${plantillas.length} plantilla(s) encontrada(s):\n`);
  for (const p of plantillas) {
    console.log(`- ${p.name}  —  ${p.status}  (${p.category}, ${p.language})`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
