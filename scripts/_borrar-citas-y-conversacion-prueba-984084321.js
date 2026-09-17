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
// IMPORTANTE -- ampliado tras encontrar un bug real en vivo (2026-09-17):
// Ahorróptica exige RUT+teléfono para agendar, y crearCitaValidada
// sobrescribe Cliente.telefono con el teléfono de CONTACTO que el cliente
// confirma en cada agendamiento (comportamiento heredado, no nuevo -- ver
// disponibilidad.js#crearCitaValidada). Como el teléfono de WhatsApp real
// (telefonoCliente) nunca cambia, pero el chatbotEngine.js busca/crea
// Cliente por ESE mismo campo telefono, la PRIMERA vez que se sobrescribe
// deja de encontrar al Cliente original en el turno siguiente -- y crea
// uno NUEVO. Esta prueba agendó 2 veces con 2 teléfonos de contacto
// distintos, así que quedaron 2 Cliente distintos (uno huérfano, ya no
// vinculado a la Conversacion actual). Por eso acá se busca por TODAS las
// vías posibles: la Conversacion (nunca cambia de teléfono), Y por los
// nombres/teléfonos de contacto ficticios conocidos de esta prueba en
// particular, para encontrar también el Cliente huérfano.
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
// Nombres y teléfonos de contacto ficticios usados en esta prueba puntual
// (de la captura de WhatsApp real que el usuario compartió) -- para
// encontrar también el Cliente huérfano que quedó desvinculado de la
// Conversacion actual.
const NOMBRES_FICTICIOS = ['Pedro Marín', 'Ximena Sánchez'];
const TELEFONOS_CONTACTO_FICTICIOS = ['912345678', '956756756'];
const APLICAR = process.env.APLICAR === '1';

async function main() {
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO },
  });

  const clienteIds = new Set();

  if (conversaciones.length > 0) {
    console.log(`Conversacion(es) encontradas: ${conversaciones.length}`);
    for (const conv of conversaciones) {
      console.log(`  - ${conv.id} -- ${Array.isArray(conv.mensajes) ? conv.mensajes.length : 0} turnos guardados -- clienteId: ${conv.clienteId}`);
      if (conv.clienteId) clienteIds.add(conv.clienteId);
    }
  } else {
    console.log(`No se encontró ninguna Conversacion para ${TELEFONO}.`);
  }

  // Cliente(s) huérfano(s) -- ya no vinculados a la Conversacion actual,
  // pero identificables por el nombre/teléfono ficticio de esta prueba.
  const clientesPorNombreOTelefono = await prisma.cliente.findMany({
    where: {
      empresaId: EMPRESA_ID,
      OR: [
        { nombre: { in: NOMBRES_FICTICIOS } },
        { telefono: { in: TELEFONOS_CONTACTO_FICTICIOS } },
      ],
    },
  });
  for (const c of clientesPorNombreOTelefono) clienteIds.add(c.id);

  console.log(`\nCliente(s) encontrados en total: ${clienteIds.size}`);
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
  console.log('Los Cliente(s) NO se tocaron (incluido el huérfano) -- avisar si también se quiere limpiar eso.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
