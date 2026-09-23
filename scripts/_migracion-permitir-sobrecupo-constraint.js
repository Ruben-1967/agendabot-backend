#!/usr/bin/env node
// Migración manual (fuera de schema.prisma, mismo motivo que
// _migracion-exclude-constraint-doble-reserva.js): ajusta el EXCLUDE
// constraint "cita_no_solapa_horario" para que ignore las citas marcadas
// como esSobrecupo=true.
//
// Bug real (Ahorróptica, 2026-09-23): la función "Forzar sobrecupo" del
// panel (Tabla de citas) existe desde el 2026-09-04, pero el EXCLUDE
// constraint que se creó después (2026-09-15, doble reserva) rechaza
// CUALQUIER cita solapada a nivel de motor de base de datos, sin excepción
// -- así que "forzar sobrecupo" quedó silenciosamente roto desde que se
// creó el constraint: el admin elegía "agendar igual" y el sistema tiraba
// un error genérico igual.
//
// Corre DESPUÉS de que el schema (Cita.esSobrecupo) ya esté aplicado
// (prisma db push), y antes de desplegar el código que empieza a escribir
// ese campo -- si se corre antes, no rompe nada (esSobrecupo default false,
// el constraint simplemente no excluye ninguna fila todavía).
//
// Idempotente: DROP CONSTRAINT IF EXISTS antes de recrear.
//
// USO:
//   node scripts/_migracion-permitir-sobrecupo-constraint.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const NOMBRE_CONSTRAINT = 'cita_no_solapa_horario';

async function main() {
  const actual = await prisma.$queryRawUnsafe(
    `SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = '${NOMBRE_CONSTRAINT}'`
  );
  if (actual.length > 0 && actual[0].definicion.includes('"esSobrecupo"')) {
    console.log(`El constraint "${NOMBRE_CONSTRAINT}" ya excluye esSobrecupo -- nada que hacer.`);
    console.log('Definición actual:', actual[0].definicion);
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE "Cita" DROP CONSTRAINT IF EXISTS ${NOMBRE_CONSTRAINT};`);
  console.log(`Constraint viejo eliminado (si existía).`);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Cita"
    ADD CONSTRAINT ${NOMBRE_CONSTRAINT}
    EXCLUDE USING gist (
      "recursoAgendableId" WITH =,
      tsrange("fechaHoraInicio", "fechaHoraFin") WITH &&
    )
    WHERE (estado IN ('PENDIENTE', 'CONFIRMADA') AND "esSobrecupo" = false);
  `);
  console.log(`✅ Constraint "${NOMBRE_CONSTRAINT}" recreado -- ahora ignora las citas con esSobrecupo=true.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
