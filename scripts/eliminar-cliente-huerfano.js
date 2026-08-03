async function limpiarAhorroptica() {
  try {
    console.log('🔍 Buscando clientes demo de Ahorróptica...\n');

    const clientesDemo = await prisma.cliente.findMany({
      where: {
        empresaId: 'ahoroptica-lautaro-seed-id',
        OR: [
          { nombre: { contains: 'Demo' } },
          { nombre: { contains: 'Prueba' } },
          { nombre: { contains: 'Test' } }
        ]
      },
    });

    if (clientesDemo.length === 0) {
      console.log('✅ No hay clientes demo para eliminar\n');
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log(`📊 Encontrados ${clientesDemo.length} clientes demo:\n`);
    clientesDemo.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.nombre} (${c.telefono})`);
    });

    console.log('\n⏳ Eliminando en cascada...\n');

    const resultado = await prisma.$transaction(async (tx) => {
      let totalCitas = 0;
      let totalVentas = 0;
      let totalConversaciones = 0;
      let totalPedidos = 0;
      let totalListaEspera = 0;

      for (const cliente of clientesDemo) {
        const citasEliminadas = await tx.cita.deleteMany({
          where: { clienteId: cliente.id },
        });

        const ventasEliminadas = await tx.venta.deleteMany({
          where: { clienteId: cliente.id },
        });

        const conversacionesEliminadas = await tx.conversacion.deleteMany({
          where: { clienteId: cliente.id },
        });

        const pedidosEliminados = await tx.pedido.deleteMany({
          where: { clienteId: cliente.id },
        });

        const listaEsperaEliminada = await tx.listaEspera.deleteMany({
          where: { clienteId: cliente.id },
        });

        totalCitas += citasEliminadas.count;
        totalVentas += ventasEliminadas.count;
        totalConversaciones += conversacionesEliminadas.count;
        totalPedidos += pedidosEliminados.count;
        totalListaEspera += listaEsperaEliminada.count;
      }

      const clientesEliminados = await tx.cliente.deleteMany({
        where: {
          empresaId: 'ahoroptica-lautaro-seed-id',
          OR: [
            { nombre: { contains: 'Demo' } },
            { nombre: { contains: 'Prueba' } },
            { nombre: { contains: 'Test' } }
          ]
        },
      });

      return {
        clientes: clientesEliminados.count,
        citas: totalCitas,
        ventas: totalVentas,
        conversaciones: totalConversaciones,
        pedidos: totalPedidos,
        listaEspera: totalListaEspera,
      };
    }, {
      timeout: 30000, // Aumenta timeout a 30 segundos
    });

    console.log(`✅ Limpieza completada:\n`);
    console.log(`   - Clientes: ${resultado.clientes} eliminados`);
    console.log(`   - Citas: ${resultado.citas} eliminadas`);
    console.log(`   - Ventas: ${resultado.ventas} eliminadas`);
    console.log(`   - Conversaciones: ${resultado.conversaciones} eliminadas`);
    console.log(`   - Pedidos: ${resultado.pedidos} eliminados`);
    console.log(`   - Lista de espera: ${resultado.listaEspera} eliminadas\n`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error:`, error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}