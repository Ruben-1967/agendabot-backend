#!/usr/bin/env node
/**
 * Verifica los 2 mecanismos de la Fase 2 ("problemas de agenda"):
 *
 * 1. Idempotencia de webhook (src/lib/idempotenciaWebhook.js): el mismo
 *    wamid entregado 2 veces (reintento de Meta) debe procesarse UNA sola
 *    vez.
 * 2. Mutex por conversación (src/lib/conversacionLock.js, usado en
 *    chatbotEngine.js): 2 mensajes DISTINTOS del mismo cliente llegando
 *    casi al mismo tiempo (ráfaga) deben procesarse ambos, en orden, SIN
 *    que uno pise el turno del otro en Conversacion.mensajes -- antes de
 *    este fix, Promise.all() de 2 procesarMensajeEntrante() para la misma
 *    conversación podía terminar con solo 1 de los 2 turnos guardados
 *    (last-write-wins).
 *
 * Usa el negocio de demo "Estudio Bella Piel" (Staging) con un cliente de
 * prueba fijo. Limpia todo al final.
 *
 * USO (local, contra Staging -- SOLO Staging, nunca producción):
 *   node scripts/_probar-idempotencia-y-lock-conversacion.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { intentarMarcarProcesado } = require('../src/lib/idempotenciaWebhook');
const { procesarMensajeEntrante } = require('../src/services/chatbotEngine');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, Staging)
const TELEFONO = '+56900000301';
const WAMID_PRUEBA = 'wamid.PRUEBA_CLAUDE_IDEMPOTENCIA_TEST';

async function probarIdempotencia() {
  console.log('--- 1. Idempotencia de webhook ---');
  // Limpieza previa por si quedó de una corrida anterior interrumpida.
  await prisma.mensajeEntranteProcesado.deleteMany({ where: { id: WAMID_PRUEBA } });

  const primera = await intentarMarcarProcesado(WAMID_PRUEBA, 'whatsapp');
  const segunda = await intentarMarcarProcesado(WAMID_PRUEBA, 'whatsapp');

  console.log(`Primera vez (debe ser true): ${primera}`);
  console.log(`Segunda vez / reintento (debe ser false): ${segunda}`);

  await prisma.mensajeEntranteProcesado.deleteMany({ where: { id: WAMID_PRUEBA } });

  const ok = primera === true && segunda === false;
  console.log(ok ? '✅ Idempotencia OK\n' : '⚠️  Idempotencia FALLÓ\n');
  return ok;
}

async function probarMutexConversacion() {
  console.log('--- 2. Mutex por conversación ---');

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ${TELEFONO} ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  // Limpieza previa (conversación de una corrida anterior interrumpida).
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (cliente) {
    await prisma.cliente.delete({ where: { id: cliente.id } }).catch(() => {});
  }

  const empresa = { id: EMPRESA_ID, nombre: 'Estudio Bella Piel', rubroTemplate: null };

  // 2 mensajes DISTINTOS y reales del mismo cliente, disparados en
  // paralelo (Promise.all, sin esperar uno al otro) -- simula una ráfaga.
  await Promise.all([
    procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'Hola, primer mensaje', nombreContacto: 'PRUEBA CLAUDE', canal: 'whatsapp' }),
    procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO, textoEntrante: 'Y este es el segundo mensaje', nombreContacto: 'PRUEBA CLAUDE', canal: 'whatsapp' }),
  ]);

  const conversacion = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO, canal: 'whatsapp' } });
  const mensajes = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];
  const turnosUsuario = mensajes.filter((m) => m.rol === 'usuario');

  console.log(`Turnos de usuario guardados: ${turnosUsuario.length} (esperado: 2)`);
  for (const t of turnosUsuario) console.log(`  - "${t.contenido}"`);

  const ok = turnosUsuario.length === 2;
  console.log(ok ? '✅ Mutex OK -- ningún turno se perdió\n' : '⚠️  Mutex FALLÓ -- se perdió al menos 1 turno\n');

  // Limpieza. Los mensajes de prueba son genéricos y muy improbable que
  // disparen agendar_cita, pero por si acaso -- limpiar Cita ANTES de
  // Cliente, si no cliente.delete revienta por el FK restrict de
  // Cita.clienteId y deja basura de prueba en la base.
  const clienteFinal = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });
  if (clienteFinal) {
    await prisma.cita.deleteMany({ where: { clienteId: clienteFinal.id } });
    await prisma.cliente.delete({ where: { id: clienteFinal.id } });
  }

  return ok;
}

async function main() {
  const okIdempotencia = await probarIdempotencia();
  const okMutex = await probarMutexConversacion();

  if (okIdempotencia && okMutex) {
    console.log('✅ Fase 2 verificada de punta a punta.');
  } else {
    console.log('⚠️  Algo falló -- revisar arriba antes de continuar.');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
