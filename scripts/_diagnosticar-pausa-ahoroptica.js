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

const TELEFONO = '56921738221';

async function main() {
  const conversacion = await prisma.conversacion.findFirst({
    where: { telefono: { contains: '921738221' } },
    include: { empresa: { select: { nombre: true, whatsappNumeroId: true, whatsappPhoneNumber: true } } },
  });

  if (!conversacion) {
    console.log('No se encontró ninguna Conversacion con ese teléfono.');
    await prisma.$disconnect();
    return;
  }

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
