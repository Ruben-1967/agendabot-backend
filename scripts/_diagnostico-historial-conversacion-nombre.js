#!/usr/bin/env node
// Uso puntual: busca un Cliente de Ahorróptica por nombre y muestra el
// historial COMPLETO (mensajes.rol/contenido/timestamp) de su Conversacion
// -- mismo propósito que _diagnostico-historial-conversacion-telefono.js
// pero para cuando no se tiene el teléfono a mano, solo el nombre. Solo
// lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   NOMBRE="Diego Figueroa" node scripts/_diagnostico-historial-conversacion-nombre.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const nombreBuscado = process.env.NOMBRE;
  if (!nombreBuscado) {
    throw new Error('Falta NOMBRE -- correr como: NOMBRE="Diego Figueroa" node scripts/_diagnostico-historial-conversacion-nombre.js');
  }

  const clientes = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, nombre: { contains: nombreBuscado, mode: 'insensitive' } },
  });

  if (clientes.length === 0) {
    console.log(`No se encontró ningún Cliente con nombre que calce "${nombreBuscado}" en Ahorróptica.`);
    return;
  }

  for (const cliente of clientes) {
    console.log('\n' + '='.repeat(70));
    console.log(`Cliente: ${cliente.nombre} — teléfono: ${cliente.telefono} — id: ${cliente.id}`);

    const conversacion = await prisma.conversacion.findFirst({
      where: { empresaId: EMPRESA_ID, telefono: cliente.telefono },
    });

    if (!conversacion) {
      console.log('(sin Conversacion registrada para este teléfono)');
      continue;
    }

    console.log(`Conversacion ${conversacion.id} — canal: ${conversacion.canal} — pausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn || 'null'} — escaladoAHumano: ${conversacion.escaladoAHumano}`);
    const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
    console.log(`Total de turnos guardados: ${mensajes.length}\n`);

    for (const m of mensajes) {
      const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
      console.log(`[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
    }

    const citas = await prisma.cita.findMany({
      where: { empresaId: EMPRESA_ID, clienteId: cliente.id },
      orderBy: { fechaHoraInicio: 'asc' },
    });
    console.log(`\nCitas de este cliente: ${citas.length}`);
    for (const c of citas) {
      console.log(`  - ${c.id} | estado: ${c.estado} | ${c.fechaHoraInicio.toISOString()} | creada: ${c.creadoEn.toISOString()}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
