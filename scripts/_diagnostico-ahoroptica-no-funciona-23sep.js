#!/usr/bin/env node
// Diagnóstico rápido y completo: Ahorróptica reportó que "el sistema no
// está funcionando" (2026-09-23), sin más detalle. Este script revisa, en
// UNA corrida, las causas más probables ya vistas fallar este mes para
// este negocio: WhatsApp desconectado/token roto, fallas de entrega
// recientes, conversaciones pausadas por Coexistence, reservas colgadas,
// y si el bot realmente dejó de responder (última actividad real). Solo
// lectura -- no repara nada, solo diagnostica.
//
// USO (Shell de Render, PRODUCCIÓN -- los datos reales de Ahorróptica
// viven ahí, no en Staging):
//   node scripts/_diagnostico-ahoroptica-no-funciona-23sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) {
    console.log('❌ No se encontró la Empresa Ahorróptica con ese ID en este entorno.');
    return;
  }

  console.log('='.repeat(70));
  console.log(`EMPRESA: ${empresa.nombre} (${empresa.id})`);
  console.log('='.repeat(70));

  // 1. Conexión de WhatsApp -- sin esto, el bot ni siquiera puede recibir
  // ni mandar mensajes.
  console.log('\n--- 1. Conexión WhatsApp ---');
  console.log(`whatsappNumeroId: ${empresa.whatsappNumeroId || '❌ VACÍO'}`);
  console.log(`whatsappWabaId: ${empresa.whatsappWabaId || '❌ VACÍO'}`);
  console.log(`whatsappPhoneNumber: ${empresa.whatsappPhoneNumber || '(vacío)'}`);
  if (empresa.whatsappToken) {
    const token = descifrarSiCorresponde(empresa.whatsappToken);
    console.log(`whatsappToken: ${token ? `✅ descifra OK (${token.length} caracteres)` : '❌ NO DESCIFRA -- token corrupto o clave de cifrado distinta'}`);
  } else {
    console.log('whatsappToken: ❌ VACÍO');
  }

  // 2. ¿Está bloqueada por prueba vencida (aunque Ahorróptica es cliente
  // real, no demo -- por si acaso quedó mal marcada)?
  console.log('\n--- 2. Estado de la cuenta ---');
  console.log(`esDemo: ${empresa.esDemo}`);
  console.log(`bloqueadaPorPruebaVencida: ${empresa.bloqueadaPorPruebaVencida ? '⚠️ TRUE -- esto bloquearía el bot' : 'false'}`);
  console.log(`pruebahasta: ${empresa.pruebahasta || '(sin fecha de prueba, cliente pagado)'}`);

  // 3. Fallas de entrega de WhatsApp recientes (72h, ventana más amplia
  // que el chequeo diario para no perderse nada de fin de semana).
  console.log('\n--- 3. Fallas de entrega de WhatsApp (últimas 72h) ---');
  const desde72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const fallas = await prisma.fallaEnvioWhatsApp.findMany({
    where: { empresaId: EMPRESA_ID, creadoEn: { gte: desde72h } },
    orderBy: { creadoEn: 'desc' },
  });
  if (fallas.length === 0) {
    console.log('✅ Sin fallas registradas.');
  } else {
    console.log(`⚠️ ${fallas.length} falla(s):`);
    for (const f of fallas.slice(0, 15)) {
      console.log(`  - ${f.creadoEn.toISOString()} | ${f.telefono || '(sin teléfono)'} | código ${f.errorCodigo || '?'} | ${f.errorMensaje || '(sin detalle)'}`);
    }
  }

  // 4. Conversaciones pausadas por Coexistence (echo de humano detectado) --
  // si el bot está "pausado" para muchas conversaciones a la vez, se ve
  // como que "no funciona" aunque el código esté sano.
  console.log('\n--- 4. Conversaciones pausadas por Coexistence ---');
  const pausadas = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, pausadaPorHumanoEn: { not: null } },
    select: { telefono: true, pausadaPorHumanoEn: true, contencionEnviadaEn: true },
    orderBy: { pausadaPorHumanoEn: 'desc' },
  });
  if (pausadas.length === 0) {
    console.log('✅ Ninguna conversación pausada por Coexistence ahora mismo.');
  } else {
    console.log(`⚠️ ${pausadas.length} conversación(es) pausada(s):`);
    for (const p of pausadas.slice(0, 15)) {
      const horas = ((Date.now() - new Date(p.pausadaPorHumanoEn)) / (1000 * 60 * 60)).toFixed(1);
      console.log(`  - ${p.telefono} | pausada hace ${horas}h | contención enviada: ${p.contencionEnviadaEn ? 'sí' : 'no'}`);
    }
  }

  // 5. ¿El bot sigue respondiendo? -- últimas 10 conversaciones con
  // actividad, mostrando el último intercambio real.
  console.log('\n--- 5. Actividad reciente (últimas 10 conversaciones) ---');
  const recientes = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID },
    orderBy: { actualizadoEn: 'desc' },
    take: 10,
    select: { telefono: true, actualizadoEn: true, mensajes: true, pausadaPorHumanoEn: true, reservaEnCurso: true },
  });
  for (const c of recientes) {
    const mensajes = Array.isArray(c.mensajes) ? c.mensajes : [];
    const ultimo = mensajes[mensajes.length - 1];
    const minutos = ((Date.now() - new Date(c.actualizadoEn)) / (1000 * 60)).toFixed(0);
    console.log(`  - ${c.telefono} | hace ${minutos}min | último rol: ${ultimo?.rol || '?'} | "${(ultimo?.contenido || '').slice(0, 80)}"${c.pausadaPorHumanoEn ? ' [PAUSADA]' : ''}`);
  }

  // 6. Reservas en curso colgadas (mismo criterio que chequeoD del job diario).
  console.log('\n--- 6. Reservas en curso activas ---');
  const conReserva = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, reservaEnCurso: { not: null } },
    select: { telefono: true, actualizadoEn: true },
  });
  console.log(`${conReserva.length} conversación(es) con reservaEnCurso activo.`);

  // 7. Citas a punto de auto-cancelarse (señal de que los recordatorios no
  // se están confirmando -- puede ser el síntoma que el cliente ve).
  console.log('\n--- 7. Citas a punto de auto-cancelarse ---');
  const citasRiesgo = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID, estado: 'PENDIENTE', confirmacionIntentos: { gte: 2 } },
    include: { cliente: { select: { nombre: true, telefono: true } } },
    orderBy: { fechaHoraInicio: 'asc' },
  });
  if (citasRiesgo.length === 0) {
    console.log('✅ Ninguna.');
  } else {
    for (const c of citasRiesgo) {
      console.log(`  - ${c.nombrePaciente || c.cliente?.nombre} (${c.cliente?.telefono}) | intentos: ${c.confirmacionIntentos} | cita: ${c.fechaHoraInicio.toISOString()}`);
    }
  }

  // 8. Volumen de citas nuevas últimos 7 días vs semana anterior -- una
  // caída brusca sería señal de que el bot dejó de poder agendar.
  console.log('\n--- 8. Volumen de citas nuevas (creadoEn) ---');
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const hace14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const citasUltimos7 = await prisma.cita.count({ where: { empresaId: EMPRESA_ID, creadoEn: { gte: hace7d } } });
  const citasSemanaAnterior = await prisma.cita.count({ where: { empresaId: EMPRESA_ID, creadoEn: { gte: hace14d, lt: hace7d } } });
  console.log(`Últimos 7 días: ${citasUltimos7} citas nuevas.`);
  console.log(`7 días anteriores: ${citasSemanaAnterior} citas nuevas.`);
  if (citasSemanaAnterior > 0 && citasUltimos7 < citasSemanaAnterior * 0.3) {
    console.log('⚠️ Caída fuerte (>70%) en citas nuevas -- posible corte real.');
  }

  console.log('\n' + '='.repeat(70));
  console.log('Fin del diagnóstico. Revisa arriba cualquier ⚠️/❌.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
