#!/usr/bin/env node
// Prueba la extracción de datos de un interesado (panel Clientes Web, fase 2) contra el
// modelo real, SIN base de datos: le pasa conversaciones del guion de Multidigital y
// revisa que saque negocio, rubro, nombre, comuna, preferencia y horario sin inventar.
// Llamadas reales a Anthropic (centavos). No manda WhatsApp ni escribe en la base.
//
// USO (necesita ANTHROPIC_API_KEY, ej. Shell de Render staging):
//   node scripts/_probar-lead-cliente-web-23oct.js

require('dotenv').config();
const { extraerDatosLeadWeb } = require('../src/services/claude');

let fallas = 0;
function verificar(descripcion, condicion, detalle) {
  console.log(`${condicion ? '✅' : '❌'} ${descripcion}${condicion ? '' : `  -> ${detalle}`}`);
  if (!condicion) fallas++;
}
const conv = (pares) => pares.map(([rol, contenido]) => ({ rol, contenido }));

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en el entorno.');

  console.log('\n1) Camino del ejemplo');
  let d = await extraerDatosLeadWeb(conv([
    ['usuario', 'Hola'], ['asistente', '¡Buenas tardes! 👋 Te saluda el equipo de Multidigital… ¿Qué prefieres?'],
    ['usuario', 'El ejemplo'], ['asistente', '¡Genial! ¿De qué se trata tu negocio y cómo se llama?'],
    ['usuario', 'Es una peluquería, se llama Estilo Ana'], ['asistente', '¿Cómo te llamas tú?'],
    ['usuario', 'Me llamo Ana y estamos en Puerto Montt'], ['asistente', '¡Gracias, Ana! Te contactamos durante el día 🙌'],
  ]));
  console.log('  ', JSON.stringify(d));
  verificar('negocio Estilo Ana', /estilo ana/i.test(d.negocio || ''), d.negocio);
  verificar('rubro peluquería', /peluquer/i.test(d.rubro || ''), d.rubro);
  verificar('nombre Ana', /^ana$/i.test((d.contactoNombre || '').trim()), d.contactoNombre);
  verificar('comuna Puerto Montt', /puerto montt/i.test(d.comuna || ''), d.comuna);
  verificar('prefirió el ejemplo', d.preferencia === 'EJEMPLO', d.preferencia);

  console.log('\n2) Camino de la llamada');
  d = await extraerDatosLeadWeb(conv([
    ['usuario', 'Buenas'], ['asistente', '¡Buenas tardes! … ¿Qué prefieres?'],
    ['usuario', 'Prefiero que me llamen'], ['asistente', '¿De qué se trata tu negocio y cómo se llama?'],
    ['usuario', 'Tengo un taller mecánico, Taller Rojas'], ['asistente', '¿Cuál es tu nombre y en qué comuna están?'],
    ['usuario', 'Soy Pedro, de Rancagua'], ['asistente', '¿En qué horario te acomoda que te llamemos?'],
    ['usuario', 'En la tarde, después de las 15:00'], ['asistente', '¡Gracias, Pedro! Te llamamos en el horario que nos indicaste 🙌'],
  ]));
  console.log('  ', JSON.stringify(d));
  verificar('negocio Taller Rojas', /taller rojas/i.test(d.negocio || ''), d.negocio);
  verificar('prefirió llamada', d.preferencia === 'LLAMADA', d.preferencia);
  verificar('horario después de las 15', /15/.test(d.horarioLlamada || ''), d.horarioLlamada);

  console.log('\n3) Pide una persona sin dar datos (no debe inventar)');
  d = await extraerDatosLeadWeb(conv([
    ['usuario', 'Hola'], ['asistente', '¡Buenas tardes! … ¿Qué prefieres?'],
    ['usuario', 'Quiero hablar con una persona'], ['asistente', 'Claro, te derivo con alguien del equipo 🙌'],
  ]));
  console.log('  ', JSON.stringify(d));
  verificar('sin negocio ni nombre inventados', !(d.negocio || '').trim() && !(d.contactoNombre || '').trim(), JSON.stringify(d));

  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron.` : '\n✅ Todas las verificaciones pasaron.');
  process.exitCode = fallas ? 1 : 0;
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
