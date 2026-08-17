#!/usr/bin/env node
/**
 * Solo lectura: no llama a Flow ni a ningún servicio externo. Muestra el
 * largo exacto y los primeros/últimos caracteres de FLOW_API_KEY/SECRET tal
 * como los ve Node en este proceso — para detectar espacios, comillas o
 * saltos de línea de más que quedaron invisibles al copiar/pegar en Render
 * (causa típica de "apiKey not found" incluso cuando el valor "se ve" igual
 * a mano en la interfaz de Flow).
 *
 * Uso (Render Shell):
 *   node scripts/diagnosticar-credenciales-flow.js
 */

require('dotenv').config();

function describir(nombre, valor) {
  if (!valor) {
    console.log(`${nombre}: ❌ no está seteada`);
    return;
  }

  const tieneEspaciosBorde = valor !== valor.trim();
  const tieneComillas = /^['"]|['"]$/.test(valor);
  const tieneSaltoLinea = /[\r\n]/.test(valor);

  console.log(`${nombre}:`);
  console.log(`  Largo: ${valor.length} caracteres`);
  console.log(`  Empieza con: "${valor.slice(0, 4)}..."`);
  console.log(`  Termina con: "...${valor.slice(-4)}"`);
  console.log(`  ¿Espacios al borde?: ${tieneEspaciosBorde ? '⚠️  SÍ — hay que sacarlos' : 'no'}`);
  console.log(`  ¿Comillas incluidas?: ${tieneComillas ? '⚠️  SÍ — hay que sacarlas' : 'no'}`);
  console.log(`  ¿Salto de línea incluido?: ${tieneSaltoLinea ? '⚠️  SÍ — hay que sacarlo' : 'no'}`);
  console.log('');
}

console.log(`FLOW_ENDPOINT: ${process.env.FLOW_ENDPOINT || '❌ no está seteada'}\n`);
describir('FLOW_API_KEY', process.env.FLOW_API_KEY);
describir('FLOW_API_SECRET', process.env.FLOW_API_SECRET);
