// Script de backfill, uso único — corrige el bug donde POST
// /leads/pool/:id/asignar escribía Lead.vendedorId pero nunca
// DemoAsignada.vendedorId (que es lo que lee "Mis casos", ver
// listarLeadsConSLA en src/services/slaService.js). Encuentra leads de
// origen whatsapp_demo con estado "asignado" cuya DemoAsignada no coincida
// en vendedorId, y la sincroniza.
const prisma = require('../src/lib/prisma');

async function main() {
  const leadsAsignados = await prisma.lead.findMany({
    where: { origen: 'whatsapp_demo', estado: 'asignado', vendedorId: { not: null } },
    select: { id: true, origenId: true, vendedorId: true },
  });

  console.log(`Leads asignados (origen whatsapp_demo) encontrados: ${leadsAsignados.length}`);

  let corregidos = 0;
  for (const lead of leadsAsignados) {
    const demo = await prisma.demoAsignada.findUnique({
      where: { id: lead.origenId },
      select: { id: true, telefono: true, vendedorId: true, derivadoAVendedor: true },
    });

    if (!demo) {
      console.warn(`  [SIN DEMO] Lead ${lead.id} apunta a DemoAsignada ${lead.origenId}, que no existe.`);
      continue;
    }

    if (demo.vendedorId === lead.vendedorId && demo.derivadoAVendedor) {
      console.log(`  [OK] Lead ${lead.id} / demo ${demo.telefono} — ya estaba sincronizado.`);
      continue;
    }

    await prisma.demoAsignada.update({
      where: { id: demo.id },
      data: {
        vendedorId: lead.vendedorId,
        derivadoAVendedor: true,
        derivadoEn: new Date(),
        motivoDerivacion: 'asignado_manual_admin',
      },
    });
    console.log(`  [CORREGIDO] Lead ${lead.id} / demo ${demo.telefono} — vendedorId ${demo.vendedorId || 'null'} -> ${lead.vendedorId}.`);
    corregidos++;
  }

  console.log(`\nResumen: ${corregidos} DemoAsignada corregidas de ${leadsAsignados.length} leads revisados.`);
}

main()
  .catch((err) => { console.error('Error en backfill:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
