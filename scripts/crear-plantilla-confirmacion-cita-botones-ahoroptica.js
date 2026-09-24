#!/usr/bin/env node
// Crea las 2 plantillas nuevas con botones "Sí, confirmo" / "No puedo" en la
// WABA real de Ahorróptica -- pedido explícito 2026-09-24 tras un caso real
// (Carlos Silva): confirmar por texto libre es ambiguo, un cliente escribió
// "Si hay estaré a las 9:30" y no calzó con el regex de confirmación (ver
// server.js), cayendo al pipeline general de Claude por error.
//
// Mismo patrón que scripts/_crear-plantilla-recordatorio-control-anual-luxvision.js:
// usa el whatsappToken/whatsappWabaId YA guardados en la Empresa (se
// descifra solo al leer, ver CAMPOS_CIFRADOS en src/lib/prisma.js), en vez
// de las variables de entorno DEMO_* (esta plantilla vive en la WABA propia
// de Ahorróptica, no en la WABA compartida de demos).
//
// NO activa nada -- src/jobs/confirmarCitasProximas.js sigue usando las
// plantillas de texto de siempre hasta que el usuario confirme que Meta
// aprobó estas 2. Solo CREA, queda pendiente de revisión (horas a 1-2 días).
//
// USO (Shell de Render, producción):
//   node scripts/crear-plantilla-confirmacion-cita-botones-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const WABA_ID_ESPERADO = '1135405548354387';
const GRAPH_API_VERSION = 'v21.0';

const BOTONES = ['Sí, confirmo', 'No puedo'];

const PLANTILLAS = [
  {
    nombre: 'confirmacion_cita_recordatorio_botones',
    texto: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}} horas. Por favor confirma tu asistencia 👇',
    ejemplos: ['Carlos Silva', 'Ahorróptica (Sucursal Lautaro)', '25 de septiembre', '09:30'],
  },
  {
    nombre: 'confirmacion_cita_ultimo_aviso_botones',
    texto: 'Hola {{1}}, este es el último aviso para tu cita en {{2}} el {{3}} a las {{4}} horas. Si no confirmas ahora, liberaremos tu horario 👇',
    ejemplos: ['Carlos Silva', 'Ahorróptica (Sucursal Lautaro)', '25 de septiembre', '09:30'],
  },
];

async function existeYa(wabaId, token, nombre) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(nombre)}`;
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const datos = await respuesta.json();
  return respuesta.ok && (datos.data || []).length > 0 ? datos.data : null;
}

async function crearPlantilla(wabaId, token, plantilla) {
  const yaExiste = await existeYa(wabaId, token, plantilla.nombre);
  if (yaExiste) {
    console.log(`Ya existe "${plantilla.nombre}" -- no se creó de nuevo:`);
    console.log(JSON.stringify(yaExiste, null, 2));
    return;
  }

  const components = [
    { type: 'BODY', text: plantilla.texto, example: { body_text: [plantilla.ejemplos] } },
    { type: 'BUTTONS', buttons: BOTONES.map((texto) => ({ type: 'QUICK_REPLY', text: texto })) },
  ];

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: plantilla.nombre, language: 'es', category: 'UTILITY', components }),
  });
  const data = await response.json();

  if (!response.ok) {
    console.error(`❌ Meta rechazó "${plantilla.nombre}":`, JSON.stringify(data, null, 2));
    return;
  }
  console.log(`✅ "${plantilla.nombre}" enviada a revisión:`, JSON.stringify(data));
}

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, whatsappToken: true, whatsappWabaId: true },
  });

  if (!empresa) throw new Error('No se encontró la Empresa de Ahorróptica.');
  if (!empresa.whatsappToken) throw new Error('Ahorróptica no tiene whatsappToken guardado.');
  if (empresa.whatsappWabaId !== WABA_ID_ESPERADO) {
    throw new Error(`whatsappWabaId guardado (${empresa.whatsappWabaId}) no coincide con el esperado (${WABA_ID_ESPERADO}) -- abortado por seguridad.`);
  }

  for (const plantilla of PLANTILLAS) {
    await crearPlantilla(empresa.whatsappWabaId, empresa.whatsappToken, plantilla);
  }

  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes (horas a 1-2 días). Hasta que se aprueben, confirmarCitasProximas.js sigue usando las plantillas de texto de siempre -- avísame cuando estén aprobadas para activar el cambio.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
