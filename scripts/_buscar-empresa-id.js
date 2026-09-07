#!/usr/bin/env node
// Uso puntual: para cada Empresa cuyo nombre contiene "Luxvision", imprime
// id, usuarios, conteo de clientes, y datos de conexión de WhatsApp (solo
// el phoneNumberId/wabaId/numero legible -- nunca el token) y fecha de
// creación -- para entender la duplicación de Empresas encontrada y decidir
// cómo unificarla. Solo lectura, no toca nada.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Luxvision', mode: 'insensitive' } },
    select: {
      id: true,
      nombre: true,
      creadoEn: true,
      whatsappNumeroId: true,
      whatsappWabaId: true,
      whatsappPhoneNumber: true,
      recordatorioControlAnualPausado: true,
      usuarios: { select: { email: true, nombre: true, rol: true } },
      _count: { select: { clientes: true } },
    },
  });
  console.log(JSON.stringify(empresas, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
