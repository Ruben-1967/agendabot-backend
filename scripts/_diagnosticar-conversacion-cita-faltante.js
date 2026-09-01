#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA: revisa el historial completo de mensajes de
 * un cliente puntual de Ahorróptica (reportado: agendó por WhatsApp para el
 * sábado 12 de sep 2026 a las 11:15, recibió confirmación de éxito, pero la
 * cita no existe en la base — ver diagnóstico anterior). Objetivo: ver el
 * mensaje exacto de confirmación del cliente y la respuesta del bot, para
 * saber si el bot reportó éxito pese a que agendar_cita falló, o si pasó
 * otra cosa.
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-conversacion-cita-faltante.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_BUSCADO = '940369712'; // dígitos significativos, sin +56

async function main() {
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, telefono: { contains: TELEFONO_BUSCADO } },
    include: { cliente: { select: { nombre: true, telefono: true } } },
  });

  if (conversaciones.length === 0) {
    console.log('No se encontró ninguna Conversacion con ese teléfono para Ahorróptica.');
    await prisma.$disconnect();
    return;
  }

  for (const conv of conversaciones) {
    console.log(`\n=== Conversacion ${conv.id} | telefono=${conv.telefono} | cliente=${conv.cliente?.nombre || '(sin cliente vinculado)'} | creadoEn=${conv.creadoEn.toISOString()} | actualizadoEn=${conv.actualizadoEn.toISOString()} ===`);
    const mensajes = conv.mensajes || [];
    console.log(`Total mensajes: ${mensajes.length}\n`);
    mensajes.forEach((m, i) => {
      console.log(`[${i}] (${m.rol}) ${m.timestamp || ''}`);
      console.log(`    ${m.contenido}`);
    });
  }

  // También busca si hay algún Cliente con este teléfono y sus citas (de
  // cualquier fecha), por si el cliente sí quedó creado pero sin cita.
  const cliente = await prisma.cliente.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: { contains: TELEFONO_BUSCADO } },
    include: { citas: true },
  });
  console.log('\n=== Cliente asociado a ese teléfono ===');
  if (!cliente) {
    console.log('No existe ningún Cliente con ese teléfono.');
  } else {
    console.log(`id=${cliente.id} nombre=${cliente.nombre} telefono=${cliente.telefono}`);
    console.log(`Citas de este cliente (${cliente.citas.length}):`);
    cliente.citas.forEach((c) => {
      console.log(`- id=${c.id} fechaHoraInicio(UTC)=${c.fechaHoraInicio.toISOString()} estado=${c.estado} recursoAgendableId=${c.recursoAgendableId}`);
    });
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
