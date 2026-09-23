#!/usr/bin/env node
// Uso puntual: la conversación de Ahorróptica con teléfono 56981276958 lleva
// ~151h pausada por Coexistence sin reactivarse sola -- pausaCoexistence.js
// debería reactivarla a las 2h de silencio del CLIENTE (no desde la pausa).
// Este script imprime los datos crudos para entender por qué el cálculo no
// se está cumpliendo (timestamp corrupto, cliente sí sigue escribiendo,
// etc.). Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_inspeccionar-conversacion-pausada-56981276958.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const TELEFONO = '56981276958';
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });
  if (!conversacion) {
    console.log('No se encontró la conversación.');
    return;
  }

  console.log('pausadaPorHumanoEn:', conversacion.pausadaPorHumanoEn);
  console.log('contencionEnviadaEn:', conversacion.contencionEnviadaEn);
  console.log('alertaUrgenteEnviadaEn:', conversacion.alertaUrgenteEnviadaEn);
  console.log('actualizadoEn:', conversacion.actualizadoEn);
  console.log('canal:', conversacion.canal);

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  console.log(`\n${mensajes.length} mensaje(s) totales. Últimos 8:`);
  for (const m of mensajes.slice(-8)) {
    const ts = m.timestamp;
    const fecha = new Date(ts);
    const valido = !isNaN(fecha.getTime());
    console.log(`  [${m.rol}] ts="${ts}" -> ${valido ? fecha.toISOString() : '❌ INVÁLIDO'} | "${(m.contenido || '').slice(0, 60)}"`);
  }

  const mensajesCliente = mensajes.filter((m) => m.rol === 'usuario');
  const ultimoCliente = mensajesCliente[mensajesCliente.length - 1];
  console.log('\nÚltimo mensaje del CLIENTE:', ultimoCliente ? JSON.stringify(ultimoCliente) : '(ninguno en el historial)');
  if (ultimoCliente) {
    const fecha = new Date(ultimoCliente.timestamp);
    const horas = (Date.now() - fecha.getTime()) / 3600000;
    console.log(`Horas desde ese mensaje: ${isNaN(horas) ? '❌ NaN (timestamp inválido -- esto bloquea la reactivación automática)' : horas.toFixed(1)}`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
