#!/usr/bin/env node
// Migración manual (fuera de schema.prisma -- Prisma no soporta EXCLUDE
// constraints declarativamente) que agrega la protección real contra doble
// reserva: un EXCLUDE constraint de Postgres que rechaza a nivel de motor
// cualquier INSERT en "Cita" cuyo rango [fechaHoraInicio, fechaHoraFin)
// se solape con otra Cita PENDIENTE o CONFIRMADA del mismo
// recursoAgendableId -- sin importar si el INSERT viene de crearCita()
// (disponibilidad.js), de un job, o de una futura edición desde el panel.
//
// Contexto (2026-09-15): crearCita() ya revalidaba disponibilidad justo
// antes de insertar, pero es un patrón check-then-act, no atómico -- dos
// clientes pidiendo el mismo horario casi al mismo tiempo podían pasar el
// check antes de que el otro completara su INSERT. Confirmado real: se
// encontraron 68 pares de Cita ya solapadas en Staging (ver
// scripts/_limpieza-citas-solapadas-staging.js, era data de demo/seed, ya
// limpiada) que bloqueaban la creación de este mismo constraint hasta
// resolverlas.
//
// El WHERE del constraint solo considera PENDIENTE/CONFIRMADA -- mismo
// criterio que ya usa obtenerHorariosDisponibles() en disponibilidad.js
// (línea ~120) para calcular qué bloquea un horario. CANCELADA/COMPLETADA/
// NO_ASISTIO nunca deben bloquear un horario nuevo.
//
// Idempotente: se puede correr más de una vez sin error (usa IF NOT
// EXISTS / verifica antes de crear el constraint).
//
// USO:
//   node scripts/_migracion-exclude-constraint-doble-reserva.js
//
// ANTES de correr contra una base con datos reales: auditar si existen
// citas PENDIENTE/CONFIRMADA ya solapadas (la migración fallará con un
// mensaje claro si las hay) -- NO cancelar citas reales sin revisar cada
// caso a mano primero (a diferencia del script de limpieza de Staging,
// que sí es seguro porque es data de demo).

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const NOMBRE_CONSTRAINT = 'cita_no_solapa_horario';

async function main() {
  const yaExiste = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_constraint WHERE conname = '${NOMBRE_CONSTRAINT}'`
  );
  if (yaExiste.length > 0) {
    console.log(`El constraint "${NOMBRE_CONSTRAINT}" ya existe -- nada que hacer.`);
    return;
  }

  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist;');
  console.log('Extensión btree_gist lista.');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Cita"
    ADD CONSTRAINT ${NOMBRE_CONSTRAINT}
    EXCLUDE USING gist (
      "recursoAgendableId" WITH =,
      tsrange("fechaHoraInicio", "fechaHoraFin") WITH &&
    )
    WHERE (estado IN ('PENDIENTE', 'CONFIRMADA'));
  `);
  console.log(`✅ Constraint "${NOMBRE_CONSTRAINT}" creado.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    console.error('\nSi el error menciona "conflicting key value" o "violates exclusion constraint", hay citas PENDIENTE/CONFIRMADA ya solapadas en esta base -- hay que resolverlas (cancelar la redundante, a mano y con criterio, tras revisar cada caso) antes de poder crear el constraint.');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
