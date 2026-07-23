#!/usr/bin/env node
// Crea una plantilla de mensaje de WhatsApp (Meta) desde la línea de comandos,
// sin tener que usar el Graph API Explorer a mano cada vez.
//
// USO:
//   node scripts/crear-plantilla.js <nombre> "<texto del cuerpo>" "<Boton1,Boton2>" ["<ejemplo1>|<ejemplo2>|..."]
//
// EJEMPLO:
//   node scripts/crear-plantilla.js recordatorio_limpieza_dental \
//     "Hola {{1}}, te recomendamos tu limpieza dental semestral en {{2}}. ¡Te esperamos!" \
//     "Agendar,No por ahora"
//
// Variables de entorno requeridas (ya deben existir en Render):
//   WHATSAPP_ACCESS_TOKEN  - token de acceso con permiso whatsapp_business_management
//   WHATSAPP_WABA_ID       - ID de la WhatsApp Business Account (opcional si se pasa como 5to argumento)

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';

function extraerVariables(texto) {
  const matches = texto.match(/\{\{\d+\}\}/g) || [];
  return matches;
}

/**
 * Valida la regla de Meta: ninguna variable puede quedar pegada al
 * principio o al final del texto (debe haber texto real alrededor).
 */
function validarPosicionVariables(texto) {
  const primeraVar = texto.match(/^\s*\{\{\d+\}\}/);
  if (primeraVar) {
    return 'La primera variable está al principio del texto. Agrega una palabra antes (ej. "Hola {{1}}...").';
  }

  // Texto después de la ÚLTIMA variable que aparece
  const posiciones = [...texto.matchAll(/\{\{\d+\}\}/g)];
  if (posiciones.length > 0) {
    const ultima = posiciones[posiciones.length - 1];
    const textoDespues = texto.slice(ultima.index + ultima[0].length);
    // Si lo que queda después es solo puntuación/espacios (o nada), Meta lo rechaza
    if (/^[\s.,!?¡¿]*$/.test(textoDespues)) {
      return `La última variable (${ultima[0]}) casi no tiene texto real después (solo "${textoDespues}"). Agrega una palabra o frase de cierre, ej. "...¡Te esperamos!"`;
    }
  }

  return null; // sin problemas
}

async function crearPlantilla({ nombre, textoBody, botones, ejemplos, categoria }) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;

  if (!accessToken) {
    throw new Error('Falta la variable de entorno WHATSAPP_ACCESS_TOKEN');
  }
  if (!wabaId) {
    throw new Error('Falta la variable de entorno WHATSAPP_WABA_ID');
  }

  const errorPosicion = validarPosicionVariables(textoBody);
  if (errorPosicion) {
    console.error('❌ No se envió a Meta. Problema detectado:');
    console.error('   ' + errorPosicion);
    process.exit(1);
  }

  const variables = extraerVariables(textoBody);
  const ejemplosFinales = ejemplos && ejemplos.length === variables.length
    ? ejemplos
    : variables.map((_, i) => ejemplos?.[i] || `Ejemplo ${i + 1}`);

  const components = [
    {
      type: 'BODY',
      text: textoBody,
      ...(variables.length > 0 ? { example: { body_text: [ejemplosFinales] } } : {}),
    },
  ];

  if (botones && botones.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: botones.map((texto) => ({ type: 'QUICK_REPLY', text: texto.trim() })),
    });
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
 body: JSON.stringify({
      name: nombre,
      language: 'es',
      category: categoria || 'UTILITY',
      components,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Plantilla enviada a revisión:');
  console.log(JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------
// Lectura de argumentos de línea de comandos
// ------------------------------------------------------------
const [, , nombre, textoBody, botonesArg, ejemplosArg, categoriaArg] = process.argv;

if (!nombre || !textoBody) {
  console.log('Uso: node scripts/crear-plantilla.js <nombre> "<texto>" "<Boton1,Boton2>" ["<ej1>|<ej2>"]');
  process.exit(1);
}

const botones = botonesArg ? botonesArg.split(',').map((b) => b.trim()) : [];
const ejemplos = ejemplosArg ? ejemplosArg.split('|').map((e) => e.trim()) : null;

crearPlantilla({ nombre, textoBody, botones, ejemplos, categoria: categoriaArg }).catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
