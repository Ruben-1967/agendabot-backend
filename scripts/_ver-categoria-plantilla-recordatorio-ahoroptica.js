#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: categoría real (UTILITY/MARKETING/AUTHENTICATION)
 * con la que Meta aprobó las plantillas de recordatorio de cita
 * (confirmacion_cita_recordatorio, confirmacion_cita_ultimo_aviso) en la
 * WABA propia de Ahorróptica — para saber si ese envío tiene costo de
 * marketing o no. Usa el whatsappWabaId/whatsappToken ya guardados en la
 * Empresa (no hace falta buscar nada en Meta a mano).
 *
 * Uso (Render Shell): node scripts/_ver-categoria-plantilla-recordatorio-ahoroptica.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const GRAPH_API_VERSION = 'v21.0';
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa?.whatsappWabaId) {
    console.error('Ahorróptica no tiene whatsappWabaId guardado.');
    return;
  }

  const accessToken = descifrarSiCorresponde(empresa.whatsappToken);
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates?fields=name,status,category,language&limit=100`;

  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('Meta rechazó la solicitud:', JSON.stringify(datos, null, 2));
    return;
  }

  const plantillas = datos.data || [];
  console.log(`${plantillas.length} plantilla(s) en la WABA de Ahorróptica:\n`);
  plantillas.forEach((p) => console.log(`${p.name}  —  ${p.status}  (${p.category}, ${p.language})`));
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
