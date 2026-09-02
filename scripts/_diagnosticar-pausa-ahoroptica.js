#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: revisa el estado real de pausadaPorHumanoEn
 * para la Conversacion del número de prueba de Ahorróptica (+56 9 2173
 * 8221), reportado como "dejó de responder tras una intervención manual y
 * nunca se reactivó".
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-pausa-ahoroptica.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  // Primero se confirma a qué Empresa pertenece realmente el número de
  // prueba +56 9 2173 8221 — no se asume que sigue siendo
  // "ahoroptica-lautaro-seed-id" (ese id es el de la empresa REAL de
  // Ahorróptica, que en algún momento pudo haber quedado con otro número
  // tras conectar por Coexistence).
  const empresasCandidatas = await prisma.empresa.findMany({
    where: {
      OR: [
        { whatsappPhoneNumber: { contains: '21738221' } },
        { nombre: { contains: 'Ahorróptica', mode: 'insensitive' } },
      ],
    },
    select: { id: true, nombre: true, esDemo: true, whatsappNumeroId: true, whatsappPhoneNumber: true },
  });
  console.log('Empresas candidatas (por nombre "Ahorróptica" o número de prueba):');
  empresasCandidatas.forEach((e) => console.log(`- id=${e.id} nombre="${e.nombre}" esDemo=${e.esDemo} whatsappPhoneNumber=${e.whatsappPhoneNumber} whatsappNumeroId=${e.whatsappNumeroId}`));
  console.log('');

  const empresaDelNumeroDePrueba = empresasCandidatas.find((e) => e.whatsappPhoneNumber?.includes('21738221'));
  const empresaObjetivo = empresaDelNumeroDePrueba || empresasCandidatas[0];
  if (!empresaObjetivo) {
    console.log('No se encontró ninguna empresa candidata.');
    await prisma.$disconnect();
    return;
  }
  console.log(`Usando empresa: ${empresaObjetivo.nombre} (${empresaObjetivo.id})\n`);

  // Conversacion.telefono guarda el número del CLIENTE, no el de la
  // empresa (+56 9 2173 8221 es el número de Ahorróptica, no de quien le
  // escribió) — se busca por empresa en vez de adivinar el teléfono.
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: empresaObjetivo.id },
    include: { empresa: { select: { nombre: true, whatsappNumeroId: true, whatsappPhoneNumber: true } } },
    orderBy: { actualizadoEn: 'desc' },
  });

  console.log(`Encontradas ${conversaciones.length} conversación(es) para Ahorróptica.\n`);
  conversaciones.forEach((c) => {
    console.log(`- id=${c.id} | telefono=${c.telefono} | pausadaPorHumanoEn=${c.pausadaPorHumanoEn ? c.pausadaPorHumanoEn.toISOString() : 'null'} | actualizadoEn=${c.actualizadoEn.toISOString()}`);
  });

  const conversacion = conversaciones.find((c) => c.pausadaPorHumanoEn) || conversaciones[0];
  if (!conversacion) {
    console.log('\nNo se encontró ninguna Conversacion para esta empresa.');
    await prisma.$disconnect();
    return;
  }
  console.log(`\n--- Detalle de la conversación pausada (o la más reciente si ninguna está pausada): ${conversacion.id} ---`);

  console.log(`Conversacion ${conversacion.id} | empresa=${conversacion.empresa.nombre} | telefono=${conversacion.telefono}`);
  console.log(`whatsappNumeroId de la empresa: ${conversacion.empresa.whatsappNumeroId}`);
  console.log(`\npausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn ? conversacion.pausadaPorHumanoEn.toISOString() : 'null'}`);
  console.log(`contencionEnviadaEn: ${conversacion.contencionEnviadaEn ? conversacion.contencionEnviadaEn.toISOString() : 'null'}`);
  console.log(`alertaUrgenteEnviadaEn: ${conversacion.alertaUrgenteEnviadaEn ? conversacion.alertaUrgenteEnviadaEn.toISOString() : 'null'}`);
  console.log(`actualizadoEn: ${conversacion.actualizadoEn.toISOString()}`);

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  console.log(`\nÚltimos 10 mensajes (de ${mensajes.length} totales):`);
  mensajes.slice(-10).forEach((m) => {
    console.log(`[${m.rol}] ${m.timestamp} — ${(m.contenido || '').slice(0, 80)}`);
  });

  const mensajesCliente = mensajes.filter((m) => m.rol === 'usuario');
  const ultimoMensajeCliente = mensajesCliente[mensajesCliente.length - 1];
  if (ultimoMensajeCliente) {
    const horas = (Date.now() - new Date(ultimoMensajeCliente.timestamp).getTime()) / 3600000;
    console.log(`\nÚltimo mensaje del CLIENTE: ${ultimoMensajeCliente.timestamp} (hace ${horas.toFixed(2)}h) — texto: "${ultimoMensajeCliente.contenido}"`);
    console.log(`¿Ya pasaron 2h desde ese último mensaje del cliente? ${horas >= 2 ? 'SÍ (debería estar reactivado)' : 'NO (por eso sigue pausado, según el diseño actual)'}`);
  } else {
    console.log('\nNo hay ningún mensaje del cliente en el historial — el job nunca reactivaría por silencio.');
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
