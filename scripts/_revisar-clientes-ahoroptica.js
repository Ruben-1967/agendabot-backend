#!/usr/bin/env node
// Uso puntual: revisa los Cliente de Ahorróptica con cuánto tienen asociado
// (para saber qué se puede borrar limpio). Solo lectura, nunca imprime RUT
// (cifrado) en texto plano más allá de lo que Prisma ya descifra al leer.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Ahorróptica', mode: 'insensitive' } },
    select: { id: true, nombre: true },
  });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa "Ahorróptica".');
    process.exit(1);
  }
  console.log('Empresa:', empresa.nombre, empresa.id);

  const clientes = await prisma.cliente.findMany({
    where: { empresaId: empresa.id },
    select: {
      id: true, nombre: true, rut: true, telefono: true, creadoEn: true,
      _count: {
        select: {
          citas: true, listaEspera: true, ventas: true, conversaciones: true,
          pedidos: true, atencionesClinicas: true,
        },
      },
    },
    orderBy: { creadoEn: 'asc' },
  });

  console.log(`Total clientes: ${clientes.length}`);
  console.log(JSON.stringify(clientes, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
