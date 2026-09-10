#!/usr/bin/env node
// Uso puntual: lista las plantillas de WhatsApp de la WABA REAL de
// Ahorróptica, usando el whatsappToken ya guardado en su Empresa (se
// descifra solo) -- mismo patrón que
// scripts/_ver-plantillas-luxvision-produccion.js. Objetivo: confirmar
// si confirmacion_cita_recordatorio / confirmacion_cita_ultimo_aviso
// existen y están APPROVED en la WABA correcta, antes de asumir que el
// problema del recordatorio de citas es de lógica y no de plantilla mal
// ubicada (mismo bug que recordatorio_control_anual con LuxVision).
// Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   node scripts/_ver-plantillas-ahoroptica-produccion.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const GRAPH_API_VERSION = 'v21.0';

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, whatsappToken: true, whatsappWabaId: true, whatsappNumeroId: true },
  });

  if (!empresa) throw new Error('No se encontró la Empresa de Ahorróptica');
  if (!empresa.whatsappToken) throw new Error('Ahorróptica no tiene whatsappToken guardado');
  if (!empresa.whatsappWabaId) throw new Error('Ahorróptica no tiene whatsappWabaId guardado');

  console.log(`Empresa: ${empresa.nombre} — WABA: ${empresa.whatsappWabaId} — numeroId: ${empresa.whatsappNumeroId}`);

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
  console.log(`\n${plantillas.length} plantilla(s) encontrada(s):\n`);
  for (const p of plantillas) {
    console.log(`- ${p.name}  —  ${p.status}  (${p.category}, ${p.language})`);
  }

  const nombresEsperados = ['confirmacion_cita_recordatorio', 'confirmacion_cita_ultimo_aviso'];
  console.log('\n===== Chequeo específico =====');
  for (const nombre of nombresEsperados) {
    const encontrada = plantillas.find((p) => p.name === nombre);
    if (!encontrada) {
      console.log(`❌ "${nombre}" NO existe en esta WABA.`);
    } else if (encontrada.status !== 'APPROVED') {
      console.log(`⚠️  "${nombre}" existe pero su estado es "${encontrada.status}", no APPROVED.`);
    } else {
      console.log(`✅ "${nombre}" existe y está APPROVED.`);
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
