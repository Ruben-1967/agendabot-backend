#!/usr/bin/env node
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { whatsappToken: true, whatsappWabaId: true, whatsappNumeroId: true },
  });

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(empresa.whatsappWabaId)}/subscribed_apps`;
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${empresa.whatsappToken}` } });
  const datos = await respuesta.json();

  console.log('Apps suscritas a la WABA', empresa.whatsappWabaId, ':');
  console.log(JSON.stringify(datos, null, 2));
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
