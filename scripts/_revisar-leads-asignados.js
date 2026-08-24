// Diagnóstico de solo lectura — lista cualquier Lead con vendedorId no nulo
// o estado distinto de "sin_asignar", sin filtrar por origen, para entender
// por qué el backfill de DemoAsignada.vendedorId no encontró nada.
const prisma = require('../src/lib/prisma');

async function main() {
  const leads = await prisma.lead.findMany({
    where: {
      OR: [{ vendedorId: { not: null } }, { estado: { not: 'sin_asignar' } }],
    },
    select: {
      id: true, origen: true, origenId: true, telefono: true, email: true,
      nombreProspecto: true, estado: true, vendedorId: true, actualizadoEn: true,
    },
    orderBy: { actualizadoEn: 'desc' },
  });

  console.log(`Leads con vendedorId o estado distinto de sin_asignar: ${leads.length}`);
  for (const l of leads) {
    console.log(JSON.stringify(l));
  }
}

main()
  .catch((err) => { console.error('Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
