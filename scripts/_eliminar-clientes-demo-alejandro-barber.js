#!/usr/bin/env node
// Uso puntual (2026-09-07): elimina 3 de los 4 Cliente de Alejandro Barber,
// dejando solo "Rubén González" (el de la venta de $12.000). Verifica cada
// id + nombre + teléfono exacto antes de borrar (aborta si algo no calza).
//
// Cita.clienteId es obligatoria (bloquea el borrado si queda alguna) -- se
// borra primero. Conversacion.clienteId es opcional, queda sin cliente
// asignado (no se borra, no hace falta tocarla).
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const A_ELIMINAR = [
  { id: 'dc1a1a58-dc5b-402a-821c-3ab29d8dc109', nombre: 'Luxvision', telefono: '56984084321' },
  { id: 'a2a17b90-59b4-44b9-862f-a2b6850112d9', nombre: 'Rubén González', telefono: '56927602910' },
  { id: 'b8b1c07f-538f-4512-b67b-37382b90ace6', nombre: 'Alejandro Vergas', telefono: '56988802338' },
];
const A_MANTENER = { id: 'f68f3262-475a-4743-a42d-829ac0fd2c6e', nombre: 'Rubén González', telefono: '56927272707' };

async function main() {
  const mantener = await prisma.cliente.findUnique({ where: { id: A_MANTENER.id } });
  if (!mantener || mantener.nombre !== A_MANTENER.nombre || mantener.telefono !== A_MANTENER.telefono) {
    console.error('ABORTADO: el cliente a mantener no calza como se esperaba.');
    process.exit(1);
  }

  for (const c of A_ELIMINAR) {
    const encontrado = await prisma.cliente.findUnique({ where: { id: c.id } });
    if (!encontrado || encontrado.nombre !== c.nombre || encontrado.telefono !== c.telefono) {
      console.error(`ABORTADO: "${c.nombre}" (${c.telefono}) no calza como se esperaba (id ${c.id}). No se borró nada de este cliente.`);
      continue;
    }

    await prisma.$transaction([
      prisma.cita.deleteMany({ where: { clienteId: c.id } }),
      prisma.cliente.delete({ where: { id: c.id } }),
    ]);
    console.log(`Eliminado: ${encontrado.nombre} (${encontrado.telefono})`);
  }

  console.log('\nMantenido:', mantener.nombre, `(${mantener.telefono})`);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
