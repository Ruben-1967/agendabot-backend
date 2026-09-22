#!/usr/bin/env node
// Uso puntual: mismo propósito que _diagnostico-menu-inventado-bienvenida-ahoroptica.js
// (imprime historial + reservaEnCurso de una Conversacion real de Ahorróptica),
// pero filtrando desde una fecha -- la conversación de Diego (56997894010) tiene
// 265 turnos y el historial completo no cabía en el buffer de la terminal al
// pegarlo. Solo lectura.
//
// USO (Shell de Render, producción):
//   TELEFONO=56997894010 DESDE=2026-09-18 node scripts/_diagnostico-conversacion-diego-desde-fecha.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const telefono = process.env.TELEFONO;
  const desde = process.env.DESDE ? new Date(process.env.DESDE) : new Date(0);
  if (!telefono) {
    throw new Error('Falta TELEFONO');
  }

  const conversacion = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono } });
  if (!conversacion) {
    console.log(`No se encontró ninguna Conversacion para "${telefono}".`);
    return;
  }

  console.log(`Conversacion ${conversacion.id} — pausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn || 'null'}`);
  console.log('reservaEnCurso:', JSON.stringify(conversacion.reservaEnCurso, null, 2));

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  const filtrados = mensajes.filter((m) => !m.timestamp || new Date(m.timestamp) >= desde);
  console.log(`\nMensajes desde ${desde.toISOString()} (${filtrados.length} de ${mensajes.length} totales):`);
  for (const m of filtrados) {
    const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
    console.log(`[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
