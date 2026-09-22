#!/usr/bin/env node
// Prueba puntual, solo lectura: replica el cálculo de "usoMensajes" que
// agrega GET /agenda/dashboard/:empresaId (mensajes del bot este mes +
// costo estimado) para una Empresa real, y lo imprime para comparar a
// mano contra lo que ya sabíamos por scripts/_diagnostico-volumen-mensajes-ahoroptica.js.
// No modifica nada.
//
// USO (Shell de Render, producción):
//   EMPRESA_ID=ahoroptica-lautaro-seed-id node scripts/_probar-uso-mensajes-dashboard.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const MENSAJES_GRATIS_POR_MES = 1000;
const COSTO_CLP_POR_MENSAJE_EXCEDENTE = 19;

function mesChileISO(fecha) {
  const p = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' }).formatToParts(fecha);
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
}

async function main() {
  const empresaId = process.env.EMPRESA_ID;
  if (!empresaId) {
    throw new Error('Falta EMPRESA_ID');
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.log('No se encontró la empresa.');
    return;
  }

  const ahora = new Date();
  const mesActual = mesChileISO(ahora);
  console.log(`Empresa: ${empresa.nombre} — mes actual (Chile): ${mesActual}\n`);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId },
    select: { mensajes: true },
  });

  let mensajesBotEsteMes = 0;
  let totalTurnosAsistente = 0;
  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    for (const m of mensajes) {
      if (m.rol === 'asistente') {
        totalTurnosAsistente++;
        if (m.timestamp && mesChileISO(new Date(m.timestamp)) === mesActual) {
          mensajesBotEsteMes++;
        }
      }
    }
  }

  const mensajesExcedente = Math.max(0, mensajesBotEsteMes - MENSAJES_GRATIS_POR_MES);
  const costoEstimadoCLP = mensajesExcedente * COSTO_CLP_POR_MENSAJE_EXCEDENTE;

  console.log(`Total turnos de asistente (todo el historial, referencia): ${totalTurnosAsistente}`);
  console.log(`Mensajes del bot ESTE MES: ${mensajesBotEsteMes}`);
  console.log(`Tramo gratis: ${MENSAJES_GRATIS_POR_MES}`);
  console.log(`Excedente: ${mensajesExcedente}`);
  console.log(`Costo estimado CLP: $${costoEstimadoCLP.toLocaleString('es-CL')}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
