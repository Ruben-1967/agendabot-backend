#!/usr/bin/env node
// Uso puntual: reconstruye la cadena completa de Cliente+Cita relacionados
// a Diego (Ahorróptica) hoy -- tanto por el teléfono real de WhatsApp como
// por cualquier Cliente con nombre parecido a "Diego", para ver dónde
// quedó la cita real que esperaba confirmación y por qué el Cliente actual
// (encontrado por teléfono) ya no es el mismo. Solo lectura.
//
// USO (Shell de Render, producción):
//   TELEFONO=56997894010 node scripts/_diagnostico-cadena-completa-diego-22sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const telefono = process.env.TELEFONO;
  if (!telefono) throw new Error('Falta TELEFONO');

  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId: EMPRESA_ID,
      OR: [
        { telefono },
        { nombre: { contains: 'diego', mode: 'insensitive' } },
      ],
    },
    include: {
      citas: { orderBy: { creadoEn: 'desc' } },
      conversaciones: { select: { id: true, telefono: true } },
    },
    orderBy: { creadoEn: 'asc' },
  });

  console.log(`${clientes.length} Cliente(s) encontrado(s) (por teléfono actual O nombre "diego"):\n`);
  for (const c of clientes) {
    console.log('='.repeat(60));
    console.log(`Cliente id=${c.id}`);
    console.log(`  nombre: "${c.nombre}"`);
    console.log(`  telefono actual: "${c.telefono}"`);
    console.log(`  rut: ${c.rut || '(sin rut)'}`);
    console.log(`  creadoEn: ${c.creadoEn.toISOString()}`);
    console.log(`  Conversacion(es) apuntando a este Cliente: ${c.conversaciones.map(v => `${v.id} (tel ${v.telefono})`).join(', ') || '(ninguna)'}`);
    console.log(`  Cita(s) (${c.citas.length}):`);
    for (const cita of c.citas) {
      console.log(`    - id=${cita.id} estado=${cita.estado} confirmacionIntentos=${cita.confirmacionIntentos} fechaHoraInicio=${cita.fechaHoraInicio.toISOString()} creadoEn=${cita.creadoEn.toISOString()}`);
    }
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
