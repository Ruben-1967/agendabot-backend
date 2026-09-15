#!/usr/bin/env node
/**
 * Verifica que el constraint EXCLUDE (cita_no_solapa_horario, ver
 * scripts/_migracion-exclude-constraint-doble-reserva.js) protege de
 * verdad contra 2 clientes reservando el mismo horario casi al mismo
 * tiempo -- dispara 2 llamadas a crearCita() en paralelo (Promise.all,
 * sin esperar una a la otra) para el MISMO recurso+fecha+hora, y confirma
 * que exactamente una tiene éxito y la otra recibe HORARIO_YA_NO_DISPONIBLE
 * (no un crash ni ambas exitosas).
 *
 * Usa el negocio de demo "Estudio Bella Piel" (Staging) con 2 clientes de
 * prueba fijos y una fecha futura lejana (dentro del horizonte de agenda
 * pero sin relación con ninguna cita real). Limpia todo al final.
 *
 * USO (local, contra Staging -- SOLO Staging, nunca producción):
 *   node scripts/_probar-doble-reserva-concurrente.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { crearCita } = require('../src/services/disponibilidad');

const EMPRESA_ID = '007a8c7b-c348-4d9e-a0b8-35e1ad8dba46'; // Estudio Bella Piel (demo, Staging)
const RECURSO_ID = 'f1a9307d-93f2-4e28-bb5a-f07ca12b83e0'; // Cosmetóloga Andrea Muñoz
const SERVICIO_ID = 'b0888821-201f-442b-83ac-c6fff3d0911f'; // Limpieza facial profunda
const FECHA_ISO = '2026-09-22'; // martes, dentro del horario 10:00-19:00 y del horizonte de 28 días
const HORA = '11:00';
const TELEFONO_A = '+56900000201';
const TELEFONO_B = '+56900000202';

async function crearClienteDePrueba(telefono, nombre) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ${telefono} ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono, nombre: 'PRUEBA CLAUDE' } });
  }
  return cliente;
}

async function main() {
  const clienteA = await crearClienteDePrueba(TELEFONO_A, 'PRUEBA CLAUDE');
  const clienteB = await crearClienteDePrueba(TELEFONO_B, 'PRUEBA CLAUDE');

  console.log(`Disparando 2 crearCita() en paralelo para ${RECURSO_ID} el ${FECHA_ISO} ${HORA}...\n`);

  const resultados = await Promise.allSettled([
    crearCita({ empresaId: EMPRESA_ID, clienteId: clienteA.id, recursoAgendableId: RECURSO_ID, servicioId: SERVICIO_ID, fechaISO: FECHA_ISO, horaInicio: HORA }),
    crearCita({ empresaId: EMPRESA_ID, clienteId: clienteB.id, recursoAgendableId: RECURSO_ID, servicioId: SERVICIO_ID, fechaISO: FECHA_ISO, horaInicio: HORA }),
  ]);

  const exitosas = resultados.filter((r) => r.status === 'fulfilled');
  const fallidas = resultados.filter((r) => r.status === 'rejected');

  console.log(`Exitosas: ${exitosas.length}`);
  for (const r of exitosas) console.log(`  - Cita ${r.value.id}`);
  console.log(`Fallidas: ${fallidas.length}`);
  for (const r of fallidas) console.log(`  - ${r.reason.message}`);

  const soloUnaExitosa = exitosas.length === 1;
  const otraFalloConMensajeCorrecto = fallidas.length === 1 && fallidas[0].reason.message === 'HORARIO_YA_NO_DISPONIBLE';

  console.log('');
  if (soloUnaExitosa && otraFalloConMensajeCorrecto) {
    console.log('✅ El constraint funcionó: exactamente 1 cita se creó, la otra recibió HORARIO_YA_NO_DISPONIBLE (no un crash ni doble reserva).');
  } else {
    console.log('⚠️  Resultado inesperado -- revisar arriba. Si ambas tuvieron éxito, el constraint NO está protegiendo.');
  }

  // Limpieza
  await prisma.cita.deleteMany({ where: { clienteId: { in: [clienteA.id, clienteB.id] } } });
  await prisma.cliente.delete({ where: { id: clienteA.id } });
  await prisma.cliente.delete({ where: { id: clienteB.id } });
  console.log('\n(datos de prueba limpiados)');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
