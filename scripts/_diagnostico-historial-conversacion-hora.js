#!/usr/bin/env node
// Uso puntual: busca, entre TODAS las conversaciones de Ahorróptica, los
// turnos (usuario o asistente) cuyo timestamp caiga cerca de una hora de
// Chile dada (por defecto, hoy) -- para cuando se sabe la hora aproximada
// del incidente pero no el teléfono/nombre del cliente. Usa el mismo
// helper horaChileAFechaUTC que ya usa el resto del código (nunca asumir
// el offset a mano, ver src/lib/horaChile.js) para no repetir el bug de
// desfase de zona horaria ya documentado ahí. Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   HORA=13:59 node scripts/_diagnostico-historial-conversacion-hora.js
//   HORA=13:59 VENTANA_MIN=10 FECHA=2026-09-12 node scripts/_diagnostico-historial-conversacion-hora.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC, hoyISOEnChile } = require('../src/lib/horaChile');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const hora = process.env.HORA;
  if (!hora) {
    throw new Error('Falta HORA -- correr como: HORA="13:59" node scripts/_diagnostico-historial-conversacion-hora.js');
  }
  const fechaISO = process.env.FECHA || hoyISOEnChile();
  const ventanaMin = Number(process.env.VENTANA_MIN) || 10;

  const centro = horaChileAFechaUTC(fechaISO, hora);
  const desde = new Date(centro.getTime() - ventanaMin * 60 * 1000);
  const hasta = new Date(centro.getTime() + ventanaMin * 60 * 1000);

  console.log(`Buscando turnos entre ${desde.toISOString()} y ${hasta.toISOString()} (${fechaISO} ${hora} Chile ± ${ventanaMin} min)\n`);

  // Pre-filtro amplio por actualizadoEn (se actualiza en cada turno nuevo)
  // para no traer TODAS las conversaciones de la empresa -- después se
  // filtra en memoria por el timestamp real de cada mensaje.
  const desdeAmplio = new Date(desde.getTime() - 2 * 60 * 60 * 1000);
  const hastaAmplio = new Date(hasta.getTime() + 2 * 60 * 60 * 1000);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, actualizadoEn: { gte: desdeAmplio, lte: hastaAmplio } },
    include: { cliente: true },
  });

  let encontrados = 0;
  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    const enVentana = mensajes.filter((m) => {
      if (!m.timestamp) return false;
      const t = new Date(m.timestamp).getTime();
      return t >= desde.getTime() && t <= hasta.getTime();
    });

    if (enVentana.length === 0) continue;
    encontrados++;

    console.log('='.repeat(70));
    console.log(`Cliente: ${conv.cliente?.nombre || '(sin cliente)'} — teléfono: ${conv.telefono} — canal: ${conv.canal}`);
    console.log(`Conversacion ${conv.id} — pausadaPorHumanoEn: ${conv.pausadaPorHumanoEn || 'null'}\n`);

    // Mostramos el turno anterior y posterior a cada match, además del
    // match, para tener contexto de la conversación completa alrededor.
    for (let i = 0; i < mensajes.length; i++) {
      const m = mensajes[i];
      const t = m.timestamp ? new Date(m.timestamp).getTime() : null;
      const dentroDeVentana = t !== null && t >= desde.getTime() && t <= hasta.getTime();
      const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
      console.log(`${dentroDeVentana ? '>>> ' : '    '}[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
    }
    console.log('');
  }

  if (encontrados === 0) {
    console.log('No se encontró ningún turno en esa ventana de tiempo. Prueba ampliando VENTANA_MIN o revisando la FECHA.');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
