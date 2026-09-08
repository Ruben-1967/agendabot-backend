#!/usr/bin/env node
// Uso puntual: crea la plantilla `recordatorio_control_anual` en la WABA
// real de LuxVision ("Totemsystem Producción"), reusando el mismo texto y
// botones que ya están aprobados en la cuenta equivocada (Multidigital SpA
// / "Test WhatsApp Business Account") — ver
// scripts/_ver-plantillas-luxvision-produccion.js, que confirmó que acá
// todavía no existe. Usa el whatsappToken ya guardado en la Empresa (se
// descifra solo) en vez de WHATSAPP_ACCESS_TOKEN/WHATSAPP_WABA_ID.
//
// Solo CREA la plantilla (queda pendiente de revisión de Meta) — no manda
// ningún mensaje a ningún cliente.
//
// USO (Shell de Render, backend de producción):
//   node scripts/_crear-plantilla-recordatorio-control-anual-luxvision.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const WABA_ID_ESPERADO = '2156101751629995'; // "Totemsystem Producción"
const GRAPH_API_VERSION = 'v21.0';

const NOMBRE_PLANTILLA = 'recordatorio_control_anual';
const TEXTO_BODY = 'Hola {{1}}, ya pasó un año desde tu último control de la vista en {{2}}. Te recomendamos agendar una nueva evaluación para mantener tu receta al día.';
const BOTONES = ['Agendar', 'No por ahora'];
const EJEMPLOS = ['Juan Pérez', 'LuxVision'];

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID_LUXVISION },
    select: { nombre: true, whatsappToken: true, whatsappWabaId: true },
  });

  if (!empresa) throw new Error('No se encontró la Empresa de LuxVision');
  if (!empresa.whatsappToken) throw new Error('LuxVision no tiene whatsappToken guardado');
  if (empresa.whatsappWabaId !== WABA_ID_ESPERADO) {
    throw new Error(
      `whatsappWabaId guardado (${empresa.whatsappWabaId}) no coincide con el esperado (${WABA_ID_ESPERADO}) — abortado por seguridad.`
    );
  }

  // Guardia: si ya existe (ej. se corrió este script dos veces), no reintentar.
  const urlBusqueda = `https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates?name=${encodeURIComponent(NOMBRE_PLANTILLA)}`;
  const respuestaBusqueda = await fetch(urlBusqueda, {
    headers: { Authorization: `Bearer ${empresa.whatsappToken}` },
  });
  const datosBusqueda = await respuestaBusqueda.json();
  if (respuestaBusqueda.ok && (datosBusqueda.data || []).length > 0) {
    console.log(`Ya existe "${NOMBRE_PLANTILLA}" en esta WABA — no se creó de nuevo:`);
    console.log(JSON.stringify(datosBusqueda.data, null, 2));
    return;
  }

  const components = [
    { type: 'BODY', text: TEXTO_BODY, example: { body_text: [EJEMPLOS] } },
    { type: 'BUTTONS', buttons: BOTONES.map((texto) => ({ type: 'QUICK_REPLY', text: texto })) },
  ];

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${empresa.whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: NOMBRE_PLANTILLA,
      language: 'es',
      category: 'MARKETING',
      components,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`✅ Plantilla "${NOMBRE_PLANTILLA}" enviada a revisión en la WABA de ${empresa.nombre}:`);
  console.log(JSON.stringify(data, null, 2));
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
