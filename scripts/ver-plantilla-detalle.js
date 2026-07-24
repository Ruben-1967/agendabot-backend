#!/usr/bin/env node
// Muestra el detalle completo (componentes, cuerpo, variables, botones) de
// UNA plantilla de WhatsApp por nombre — complementa a ver-plantillas.js,
// que solo lista nombre/estado/categoría/idioma.
//
// USO:
//   node scripts/ver-plantilla-detalle.js nombre_de_la_plantilla
//
// Variables de entorno requeridas (mismas que ver-plantillas.js):
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_WABA_ID

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

async function verPlantillaDetalle(nombrePlantilla) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;

  if (!accessToken) throw new Error('Falta la variable de entorno WHATSAPP_ACCESS_TOKEN');
  if (!wabaId) throw new Error('Falta la variable de entorno WHATSAPP_WABA_ID');

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(nombrePlantilla)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const plantillas = data.data || [];

  if (plantillas.length === 0) {
    console.log(`No se encontró ninguna plantilla llamada "${nombrePlantilla}".`);
    return;
  }

  plantillas.forEach((p) => {
    console.log('\n' + '='.repeat(60));
    console.log(`Nombre:    ${p.name}`);
    console.log(`Idioma:    ${p.language}`);
    console.log(`Categoría: ${p.category}`);
    console.log(`Estado:    ${p.status}`);
    console.log('-'.repeat(60));

    (p.components || []).forEach((comp) => {
      console.log(`[${comp.type}]`);
      if (comp.text) console.log(`  Texto: ${comp.text}`);
      if (comp.format) console.log(`  Formato: ${comp.format}`);
      if (comp.buttons) {
        comp.buttons.forEach((btn, i) => {
          console.log(`  Botón ${i + 1}: [${btn.type}] "${btn.text}"${btn.url ? ` -> ${btn.url}` : ''}`);
        });
      }
      if (comp.example) {
        console.log(`  Ejemplo de variables: ${JSON.stringify(comp.example)}`);
      }
      console.log('');
    });
  });
}

const nombrePlantilla = process.argv[2];

if (!nombrePlantilla) {
  console.error('Uso: node scripts/ver-plantilla-detalle.js <nombre_de_la_plantilla>');
  process.exit(1);
}

verPlantillaDetalle(nombrePlantilla).catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});