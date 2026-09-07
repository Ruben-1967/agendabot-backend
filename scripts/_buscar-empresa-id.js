#!/usr/bin/env node
// Uso puntual: diagnóstico completo antes de migrar los pacientes importados
// de la Empresa "Luxvision" huérfana (e277ea9e...) a la Empresa real
// conectada a WhatsApp "Luxvision EIRL" (deba7912...) -- confirma que no
// hay nada más colgando de la huérfana que también haya que mover. Solo
// lectura, no toca nada.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const IDS = [
  'deba7912-6a28-44ae-8e06-d5bae0a7c1aa', // Luxvision EIRL -- la real, conectada
  'e277ea9e-5793-468c-aa96-e4a2f7457201', // Luxvision -- huérfana, con los 1903 pacientes
];

async function main() {
  for (const id of IDS) {
    const empresa = await prisma.empresa.findUnique({
      where: { id },
      select: {
        id: true, nombre: true, creadoEn: true,
        whatsappNumeroId: true, whatsappWabaId: true, whatsappPhoneNumber: true,
        recordatorioControlAnualPausado: true, esDemo: true,
        rubroTemplateId: true,
        _count: {
          select: {
            usuarios: true, clientes: true, recursos: true, servicios: true,
            citas: true, listaEspera: true, conversaciones: true, ventas: true,
          },
        },
      },
    });
    console.log(JSON.stringify(empresa, null, 2));
  }
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
