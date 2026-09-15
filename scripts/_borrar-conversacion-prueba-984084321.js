#!/usr/bin/env node
// Uso puntual: borra la Conversacion (historial de mensajes) del teléfono
// de prueba +56984084321 en Ahorróptica, para volver a probar desde cero
// -- pedido explícito del usuario (2026-09-17), es su propio número de
// prueba (confirmado: apareció "Luxvision" como nombre de perfil de
// WhatsApp arrastrado de otras pruebas, no un cliente real).
//
// Solo borra la Conversacion (mensajes) -- NO toca Cliente ni ninguna
// Cita real que pudiera existir para este teléfono, ya que no se pidió
// borrar eso.
//
// USO (Shell de Render, producción):
//   node scripts/_borrar-conversacion-prueba-984084321.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO = '56984084321';

async function main() {
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });

  if (conversaciones.length === 0) {
    console.log(`No se encontró ninguna Conversacion para ${TELEFONO} en Ahorróptica.`);
    return;
  }

  for (const c of conversaciones) {
    console.log(`Borrando Conversacion ${c.id} (canal: ${c.canal}, ${Array.isArray(c.mensajes) ? c.mensajes.length : 0} turnos guardados)...`);
  }

  const resultado = await prisma.conversacion.deleteMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });

  console.log(`\n✅ ${resultado.count} conversación(es) borrada(s). El próximo mensaje de este teléfono empieza una conversación nueva desde cero.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
