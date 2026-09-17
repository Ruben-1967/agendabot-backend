#!/usr/bin/env node
// Uso puntual: cuenta el volumen real de mensajes de Ahorróptica (todas las
// Conversacion, todos los canales) para poder estimar el costo real de
// Meta una vez que empiece a cobrar por "service messages" (ver memoria
// del proyecto: project_cobro_service_messages_octubre_2026). Desglosa por
// mes y por rol (usuario/asistente), y cuenta además las Cita reales
// creadas por mes (proxy de recordatorios/confirmaciones -- mensajes de
// plantilla, que Meta cobra en una categoría aparte de los "service
// messages" de conversación libre).
//
// Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-volumen-mensajes-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

function mesDe(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) {
    console.log('No se encontró la empresa.');
    return;
  }
  console.log(`Empresa: ${empresa.nombre} (${empresa.sucursal || 'sin sucursal'})`);
  console.log(`Creada: ${empresa.creadoEn.toISOString().split('T')[0]}\n`);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID },
    select: { id: true, canal: true, telefono: true, mensajes: true, creadoEn: true },
  });

  console.log(`Total Conversacion (clientes distintos con historial): ${conversaciones.length}`);
  const porCanal = {};
  for (const c of conversaciones) {
    porCanal[c.canal] = (porCanal[c.canal] || 0) + 1;
  }
  console.log('Por canal:', JSON.stringify(porCanal));

  // Desglose mensual de TURNOS de conversación (mensajes.rol usuario/asistente)
  const porMes = {}; // { '2026-09': { usuario: N, asistente: N } }
  let totalUsuario = 0;
  let totalAsistente = 0;

  for (const conv of conversaciones) {
    const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
    for (const m of mensajes) {
      const mes = m.timestamp ? mesDe(m.timestamp) : mesDe(conv.creadoEn);
      if (!porMes[mes]) porMes[mes] = { usuario: 0, asistente: 0 };
      if (m.rol === 'usuario') {
        porMes[mes].usuario++;
        totalUsuario++;
      } else {
        porMes[mes].asistente++;
        totalAsistente++;
      }
    }
  }

  console.log(`\nTotal turnos de USUARIO (mensajes entrantes reales): ${totalUsuario}`);
  console.log(`Total turnos de ASISTENTE (respuestas del bot): ${totalAsistente}`);
  console.log('\nDesglose mensual (turnos usuario / asistente):');
  for (const mes of Object.keys(porMes).sort()) {
    console.log(`  ${mes}: usuario=${porMes[mes].usuario}  asistente=${porMes[mes].asistente}`);
  }

  // Citas reales por mes (proxy de recordatorios/confirmaciones -- mensajes
  // de plantilla, categoría de costo distinta a la de conversación libre).
  const citas = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID },
    select: { creadoEn: true, confirmacionIntentos: true },
  });
  const citasPorMes = {};
  let totalRecordatoriosEnviados = 0;
  for (const c of citas) {
    const mes = mesDe(c.creadoEn);
    citasPorMes[mes] = (citasPorMes[mes] || 0) + 1;
    totalRecordatoriosEnviados += c.confirmacionIntentos || 0;
  }
  console.log(`\nTotal Cita reales creadas: ${citas.length}`);
  console.log('Por mes:');
  for (const mes of Object.keys(citasPorMes).sort()) {
    console.log(`  ${mes}: ${citasPorMes[mes]} cita(s)`);
  }
  console.log(`\nTotal de envíos de recordatorio de confirmación (Cita.confirmacionIntentos sumado): ${totalRecordatoriosEnviados}`);
  console.log('(cada intento es 1 mensaje de plantilla real mandado por src/jobs/confirmarCitasProximas.js)');

  console.log('\n---');
  console.log('Nota: esto cuenta mensajes guardados en nuestra base, no las "conversaciones" de 24h que Meta');
  console.log('usa para facturar -- para el costo real y exacto, la fuente de verdad es el WhatsApp Manager');
  console.log('de Meta (Business Settings > WhatsApp Accounts > facturación), no esta base de datos.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
