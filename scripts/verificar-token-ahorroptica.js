const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verificar() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: 'ahoroptica-lautaro-seed-id' },
    select: {
      empresaId: true,
      nombre: true,
      whatsappToken: true,
      whatsappWabaId: true,
      whatsappPhoneNumberId: true
    }
  });

  console.log(JSON.stringify(empresa, null, 2));
  
  await prisma.$disconnect();
}

verificar();