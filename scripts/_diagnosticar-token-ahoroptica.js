#!/usr/bin/env node
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { whatsappToken: true, whatsappNumeroId: true },
  });

  if (!empresa || !empresa.whatsappToken) {
    console.error('No se encontró token guardado.');
    process.exit(1);
  }

  console.log('Token descifrado localmente. Longitud:', empresa.whatsappToken.length, 'caracteres.');

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(empresa.whatsappNumeroId)}?fields=display_phone_number,verified_name`;
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${empresa.whatsappToken}` } });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('Meta rechazó el token descifrado localmente:', JSON.stringify(datos.error));
    process.exit(1);
  }

  console.log('Meta ACEPTÓ el token descifrado localmente. Número:', datos.display_phone_number);
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
