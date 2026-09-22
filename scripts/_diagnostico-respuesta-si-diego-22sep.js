#!/usr/bin/env node
// Uso puntual: Diego (Ahorróptica) respondió "SI" a un recordatorio de
// confirmación de cita (24h antes) y el bot le mostró horas disponibles
// en vez de confirmar. El bloque de server.js que maneja esto busca el
// Cliente por teléfono, y luego una Cita PENDIENTE con
// confirmacionIntentos>0 y clienteId = ese Cliente.id -- si el bug ya
// documentado de Cliente.telefono duplicado (ver memoria del proyecto)
// hizo que el Cliente encontrado por teléfono NO sea el mismo que el
// dueño real de la Cita, la búsqueda no encuentra nada y el mensaje cae
// al flujo normal del bot. Este script reproduce esa misma búsqueda
// exacta para confirmar o descartar la hipótesis. Solo lectura.
//
// USO (Shell de Render, producción):
//   TELEFONO=56997894010 node scripts/_diagnostico-respuesta-si-diego-22sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const telefono = process.env.TELEFONO;
  if (!telefono) throw new Error('Falta TELEFONO');

  // Paso 1: TODOS los Cliente con este teléfono (debería ser 1, si hay 2+
  // eso YA es la señal del bug de duplicado).
  const clientesConEsteTelefono = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, telefono },
  });
  console.log(`Cliente(s) con telefono="${telefono}": ${clientesConEsteTelefono.length}`);
  for (const c of clientesConEsteTelefono) {
    console.log(`  - id=${c.id} nombre="${c.nombre}" rut=${c.rut || '(sin rut)'} creadoEn=${c.creadoEn.toISOString()}`);
  }

  // Paso 2: exactamente lo que hace server.js -- findFirst (el primero que
  // calce, sin orden explícito = orden de inserción de Postgres).
  const clienteExistente = await prisma.cliente.findFirst({
    where: { empresaId: EMPRESA_ID, telefono },
  });
  console.log(`\nfindFirst (lo que usa el webhook) devuelve: ${clienteExistente ? clienteExistente.id : 'null'}`);

  // Paso 3: Cita PENDIENTE con confirmacionIntentos>0 para ESE clienteId.
  const citaPendiente = clienteExistente
    ? await prisma.cita.findFirst({
        where: { empresaId: EMPRESA_ID, clienteId: clienteExistente.id, estado: 'PENDIENTE', confirmacionIntentos: { gt: 0 } },
        orderBy: { fechaHoraInicio: 'asc' },
      })
    : null;
  console.log(`Cita PENDIENTE con confirmacionIntentos>0 para ese clienteId: ${citaPendiente ? citaPendiente.id : 'NINGUNA -- acá está el problema si hay una cita real esperando'}`);

  // Paso 4: TODAS las Cita recientes de CUALQUIERA de los Cliente
  // encontrados arriba, para ver dónde está realmente la cita que Diego
  // dice haber confirmado.
  console.log('\nTodas las Cita recientes de estos Cliente (cualquier estado):');
  for (const c of clientesConEsteTelefono) {
    const citas = await prisma.cita.findMany({
      where: { empresaId: EMPRESA_ID, clienteId: c.id },
      orderBy: { creadoEn: 'desc' },
      take: 5,
    });
    for (const cita of citas) {
      console.log(`  clienteId=${c.id} citaId=${cita.id} estado=${cita.estado} confirmacionIntentos=${cita.confirmacionIntentos} fechaHoraInicio=${cita.fechaHoraInicio.toISOString()} confirmacionUltimoEnvioEn=${cita.confirmacionUltimoEnvioEn ? cita.confirmacionUltimoEnvioEn.toISOString() : 'null'}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
