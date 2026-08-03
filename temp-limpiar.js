const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function limpiar() {
  const result = await prisma.cliente.deleteMany({
    where: {
      empresaId: 'ahoroptica-lautaro-seed-id',
      OR: [
        { nombre: { contains: 'Demo' } },
        { nombre: { contains: 'Prueba' } }
      ]
    }
  });
  console.log('Borrados:', result.count);
  await prisma.();
}

limpiar();
