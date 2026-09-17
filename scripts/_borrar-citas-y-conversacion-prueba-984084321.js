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
  const cliente = await prisma.cliente.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });

  if (!cliente) {
    console.log(`No se encontró ningún Cliente para ${TELEFONO} en Ahorróptica.`);
    return;
  }

  console.log(`Cliente ${cliente.id} -- nombre actual: "${cliente.nombre}" (no se toca, solo informativo).\n`);

  const citas = await prisma.cita.findMany({ where: { clienteId: cliente.id } });
  console.log(`Cita(s) encontradas: ${citas.length}`);
  for (const c of citas) {
    console.log(`  - ${c.id} -- ${c.fechaHoraInicio.toISOString()} -- estado: ${c.estado}`);
  }

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });
  console.log(`\nConversacion(es) encontradas: ${conversaciones.length}`);
  for (const conv of conversaciones) {
    console.log(`  - ${conv.id} -- ${Array.isArray(conv.mensajes) ? conv.mensajes.length : 0} turnos guardados`);
  }

  if (!APLICAR) {
    console.log('\n(DRY RUN -- no se borró nada. Volver a correr con APLICAR=1 para borrar de verdad.)');
    return;
  }

  const resultadoCitas = await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
  const resultadoConv = await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO } });

  console.log(`\n✅ ${resultadoCitas.count} cita(s) borrada(s).`);
  console.log(`✅ ${resultadoConv.count} conversación(es) borrada(s).`);
  console.log('El Cliente NO se tocó (queda con nombre "' + cliente.nombre + '") -- avisar si también se quiere limpiar eso.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
