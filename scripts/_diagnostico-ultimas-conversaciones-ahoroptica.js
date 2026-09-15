#!/usr/bin/env node
// Uso puntual: lista las últimas N conversaciones de Ahorróptica por
// actualizadoEn, con su hora en Chile ya convertida -- para verificar si
// realmente no hay actividad en un rango horario dado, o si hay un bug en
// la conversión de zona horaria de _diagnostico-historial-conversacion-hora.js.
// Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-ultimas-conversaciones-ahoroptica.js
//   LIMITE=50 node scripts/_diagnostico-ultimas-conversaciones-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const limite = Number(process.env.LIMITE) || 20;

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID },
    include: { cliente: true },
    orderBy: { actualizadoEn: 'desc' },
    take: limite,
  });

  console.log(`Últimas ${conversaciones.length} conversaciones de Ahorróptica (de las más recientes hacia atrás):\n`);

  for (const conv of conversaciones) {
    const horaChile = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(conv.actualizadoEn);
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    console.log(`${horaChile} (Chile) — ${conv.cliente?.nombre || '(sin cliente)'} — tel: ${conv.telefono} — canal: ${conv.canal} — ${mensajes.length} turnos`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
