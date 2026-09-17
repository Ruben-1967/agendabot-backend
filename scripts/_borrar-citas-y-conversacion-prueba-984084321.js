#!/usr/bin/env node
// Uso puntual: borra las Cita(s) reales que quedaron de la prueba en vivo
// del usuario (2026-09-17, +56984084321 -- su propio teléfono de prueba,
// ver scripts/_borrar-conversacion-prueba-984084321.js) junto con la
// Conversacion (historial de mensajes). A diferencia de ese script
// anterior (que a propósito NO tocaba citas), esta vez el usuario pidió
// explícitamente borrar también las horas que quedaron agendadas
// ("Pedro Marín" y "Ximena Sánchez", ambas ficticias, del mismo teléfono
// de prueba).
//
// NO borra el Cliente -- solo lo que se pidió (citas + mensajes). El
// Cliente.nombre puede haber quedado como "Ximena Sánchez" (la última
// actualización real durante la prueba); si se quiere limpiar eso
// también, hacerlo aparte.
//
// IMPORTANTE: se busca por la Conversacion, no por el Cliente -- Ahorróptica
// exige RUT+teléfono para agendar, y crearCitaValidada sobrescribe
// Cliente.telefono con el teléfono de CONTACTO que el cliente confirma en
// cada agendamiento (comportamiento heredado, no nuevo -- ver
// disponibilidad.js#crearCitaValidada). Como esta prueba agendó 2 veces con
// 2 teléfonos de contacto distintos, Cliente.telefono ya NO es
// "56984084321" -- pero Conversacion.telefono nunca se toca, así que sigue
// siendo la forma confiable de encontrar todo lo de esta prueba.
//
// Por defecto corre en modo DRY RUN (solo imprime qué borraría). Recién
// borra de verdad con APLICAR=1.
//
// USO (Shell de Render, producción):
//   node scripts/_borrar-citas-y-conversacion-prueba-984084321.js          # dry run
//   APLICAR=1 node scripts/_borrar-citas-y-conversacion-prueba-984084321.js # borra de verdad

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56984084321';
const APLICAR = process.env.APLICAR === '1';

async function main() {
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });

  if (conversaciones.length === 0) {
    console.log(`No se encontró ninguna Conversacion para ${TELEFONO} en Ahorróptica.`);
    return;
  }

  console.log(`Conversacion(es) encontradas: ${conversaciones.length}`);
  const clienteIds = new Set();
  for (const conv of conversaciones) {
    console.log(`  - ${conv.id} -- ${Array.isArray(conv.mensajes) ? conv.mensajes.length : 0} turnos guardados -- clienteId: ${conv.clienteId}`);
    if (conv.clienteId) clienteIds.add(conv.clienteId);
  }

  console.log(`\nCliente(s) vinculado(s): ${clienteIds.size}`);
  let citasTotales = [];
  for (const clienteId of clienteIds) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    console.log(`  - ${clienteId} -- nombre actual: "${cliente?.nombre}", telefono actual: "${cliente?.telefono}" (Cliente NO se toca, solo informativo).`);
    const citas = await prisma.cita.findMany({ where: { clienteId } });
    citasTotales = citasTotales.concat(citas);
  }

  console.log(`\nCita(s) encontradas: ${citasTotales.length}`);
  for (const c of citasTotales) {
    console.log(`  - ${c.id} -- ${c.fechaHoraInicio.toISOString()} -- estado: ${c.estado}`);
  }

  if (!APLICAR) {
    console.log('\n(DRY RUN -- no se borró nada. Volver a correr con APLICAR=1 para borrar de verdad.)');
    return;
  }

  let totalCitasBorradas = 0;
  for (const clienteId of clienteIds) {
    const r = await prisma.cita.deleteMany({ where: { clienteId } });
    totalCitasBorradas += r.count;
  }
  const resultadoConv = await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });

  console.log(`\n✅ ${totalCitasBorradas} cita(s) borrada(s).`);
  console.log(`✅ ${resultadoConv.count} conversación(es) borrada(s).`);
  console.log('Los Cliente(s) NO se tocaron -- avisar si también se quiere limpiar eso.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
