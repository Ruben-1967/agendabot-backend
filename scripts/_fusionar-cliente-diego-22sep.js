#!/usr/bin/env node
// Uso puntual, de una sola vez: fusiona los 2 registros de Diego
// (Ahorróptica) confirmados como la misma persona real por el usuario --
// 1d4b69b5... ("diego figueroa", 5 citas reales, telefono con "+" mal
// formado) y c209a488... ("🧠", 0 relaciones, telefono bien formado y la
// Conversacion activa). Sin esto, la cita PENDIENTE de mañana
// (2026-09-23 18:00 Chile) nunca va a poder confirmarse por "Sí"/"No".
//
// 1. Corrige el telefono del Cliente real al formato correcto (sin "+").
// 2. Reapunta la Conversacion activa a ese mismo Cliente real.
// 3. Borra el Cliente huérfano ("🧠") -- 0 relaciones reales, seguro.
//
// USO (Shell de Render, producción):
//   node scripts/_fusionar-cliente-diego-22sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const CLIENTE_REAL_ID = '1d4b69b5-3877-4703-897a-a7a0ecaedba2'; // "diego figueroa", 5 citas
const CLIENTE_HUERFANO_ID = 'c209a488-e66e-4de7-83cb-a56286074fb5'; // "🧠", 0 citas
const TELEFONO_CORRECTO = '56997894010';

async function main() {
  const clienteReal = await prisma.cliente.findUnique({ where: { id: CLIENTE_REAL_ID } });
  const clienteHuerfano = await prisma.cliente.findUnique({
    where: { id: CLIENTE_HUERFANO_ID },
    include: { _count: { select: { citas: true, ventas: true, listaEspera: true, pedidos: true, atencionesClinicas: true } } },
  });

  if (!clienteReal || !clienteHuerfano) {
    throw new Error('No se encontró alguno de los 2 Cliente esperados -- abortando, revisar a mano.');
  }

  const totalRelacionesHuerfano = Object.values(clienteHuerfano._count).reduce((a, b) => a + b, 0);
  if (totalRelacionesHuerfano > 0) {
    throw new Error(`El Cliente huérfano tiene ${totalRelacionesHuerfano} relación(es) reales -- ya no es seguro borrarlo sin revisar a mano. Abortando.`);
  }

  console.log(`Cliente real: "${clienteReal.nombre}" (${clienteReal.id}), telefono actual="${clienteReal.telefono}"`);
  console.log(`Cliente huérfano: "${clienteHuerfano.nombre}" (${clienteHuerfano.id}), 0 relaciones confirmadas -- seguro de borrar.\n`);

  await prisma.$transaction(async (tx) => {
    await tx.cliente.update({ where: { id: CLIENTE_REAL_ID }, data: { telefono: TELEFONO_CORRECTO } });
    const conv = await tx.conversacion.updateMany({
      where: { clienteId: CLIENTE_HUERFANO_ID },
      data: { clienteId: CLIENTE_REAL_ID },
    });
    console.log(`✅ Telefono corregido a "${TELEFONO_CORRECTO}".`);
    console.log(`✅ ${conv.count} Conversacion reapuntada(s) al Cliente real.`);
    await tx.cliente.delete({ where: { id: CLIENTE_HUERFANO_ID } });
    console.log('✅ Cliente huérfano borrado.');
  });

  console.log('\n🎉 Listo -- el próximo mensaje de Diego (o el siguiente recordatorio) ya debería encontrar su cita pendiente correctamente.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
