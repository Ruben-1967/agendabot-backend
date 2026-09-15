#!/usr/bin/env node
// Uso puntual: busca CONVERSACIONES completas de Ahorróptica con actividad
// dentro de un rango horario de Chile dado (por defecto, hoy) -- para
// cuando se sabe la hora/rango aproximado del incidente pero no el
// teléfono/nombre del cliente. El filtro es por Conversacion.actualizadoEn
// (se actualiza en cada turno nuevo), no por el timestamp de un mensaje
// puntual -- basta con que la conversación haya tenido CUALQUIER actividad
// en el rango para traerla completa. Usa el mismo helper
// horaChileAFechaUTC que ya usa el resto del código (nunca asumir el
// offset a mano, ver src/lib/horaChile.js) para no repetir el bug de
// desfase de zona horaria ya documentado ahí. Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   HORA=13:00 VENTANA_MIN=60 node scripts/_diagnostico-historial-conversacion-hora.js
//   DESDE=12:00 HASTA=14:00 FECHA=2026-09-12 node scripts/_diagnostico-historial-conversacion-hora.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC, hoyISOEnChile } = require('../src/lib/horaChile');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const fechaISO = process.env.FECHA || hoyISOEnChile();

  // 2 formas de definir el rango: DESDE/HASTA directo, o HORA ± VENTANA_MIN.
  let desde, hasta;
  if (process.env.DESDE && process.env.HASTA) {
    desde = horaChileAFechaUTC(fechaISO, process.env.DESDE);
    hasta = horaChileAFechaUTC(fechaISO, process.env.HASTA);
  } else if (process.env.HORA) {
    const ventanaMin = Number(process.env.VENTANA_MIN) || 10;
    const centro = horaChileAFechaUTC(fechaISO, process.env.HORA);
    desde = new Date(centro.getTime() - ventanaMin * 60 * 1000);
    hasta = new Date(centro.getTime() + ventanaMin * 60 * 1000);
  } else {
    throw new Error('Falta DESDE+HASTA (ej. DESDE=12:00 HASTA=14:00) o HORA (ej. HORA=13:00 VENTANA_MIN=60).');
  }

  console.log(`Buscando conversaciones con actividad entre ${desde.toISOString()} y ${hasta.toISOString()} (${fechaISO}, hora Chile)\n`);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, actualizadoEn: { gte: desde, lte: hasta } },
    include: { cliente: true },
    orderBy: { actualizadoEn: 'asc' },
  });

  if (conversaciones.length === 0) {
    console.log('No se encontró ninguna conversación con actividad en ese rango. Prueba ampliando el rango o revisando la FECHA.');
    return;
  }

  for (const conv of conversaciones) {
    console.log('='.repeat(70));
    console.log(`Cliente: ${conv.cliente?.nombre || '(sin cliente)'} — teléfono: ${conv.telefono} — canal: ${conv.canal}`);
    console.log(`Conversacion ${conv.id} — última actividad: ${conv.actualizadoEn.toISOString()} — pausadaPorHumanoEn: ${conv.pausadaPorHumanoEn || 'null'}\n`);

    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    for (const m of mensajes) {
      const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
      console.log(`[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
    }
    console.log('');
  }

  console.log(`Total: ${conversaciones.length} conversación(es) con actividad en el rango.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
