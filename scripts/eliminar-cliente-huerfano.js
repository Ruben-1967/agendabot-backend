#!/usr/bin/env node

const prisma = require('../src/lib/prisma');

async function eliminarClienteHuerfano(clienteId) {
  if (!clienteId) {
    console.error('Uso: node scripts/eliminar-cliente-huerfano.js <clienteId>');
    process.exit(1);
  }

  try {
    console.log(`🔍 Verificando cliente: ${clienteId}`);

    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      include: {
        citas: true,
        listaEspera: true,
        ventas: true,
        conversaciones: true,
        pedidos: true,
      },
    });

    if (!cliente) {
      console.error(`❌ Cliente no encontrado: ${clienteId}`);
      process.exit(1);
    }

    console.log(`\n📋 Cliente encontrado:`);
    console.log(`   Nombre: ${cliente.nombre}`);
    console.log(`   Teléfono: ${cliente.telefono || 'N/A'}`);
    console.log(`   RUT: ${cliente.rut || 'N/A'}`);
    console.log(`   Empresa: ${cliente.empresaId}`);

    console.log(`\n📊 Referencias a eliminar:`);
    console.log(`   - Citas: ${cliente.citas.length}`);
    console.log(`   - Lista de espera: ${cliente.listaEspera.length}`);
    console.log(`   - Ventas: ${cliente.ventas.length}`);
    console.log(`   - Conversaciones: ${cliente.conversaciones.length}`);
    console.log(`   - Pedidos: ${cliente.pedidos.length}`);

    // Ejecutar eliminación en transacción
    console.log(`\n⏳ Eliminando en cascada...`);
    
    const resultado = await prisma.$transaction(async (tx) => {
      // Eliminar en orden de dependencias
      const citasEliminadas = await tx.cita.deleteMany({
        where: { clienteId },
      });

      const listaEsperaEliminada = await tx.listaEspera.deleteMany({
        where: { clienteId },
      });

      const ventasEliminadas = await tx.venta.deleteMany({
        where: { clienteId },
      });

      const conversacionesEliminadas = await tx.conversacion.deleteMany({
        where: { clienteId },
      });

      const pedidosEliminados = await tx.pedido.deleteMany({
        where: { clienteId },
      });

      // Finalmente, eliminar el cliente
      const clienteEliminado = await tx.cliente.delete({
        where: { id: clienteId },
      });

      return {
        citas: citasEliminadas.count,
        listaEspera: listaEsperaEliminada.count,
        ventas: ventasEliminadas.count,
        conversaciones: conversacionesEliminadas.count,
        pedidos: pedidosEliminados.count,
        cliente: clienteEliminado,
      };
    });

    console.log(`\n✅ Cliente eliminado exitosamente:`);
    console.log(`   - Citas: ${resultado.citas} eliminadas`);
    console.log(`   - Lista de espera: ${resultado.listaEspera} eliminadas`);
    console.log(`   - Ventas: ${resultado.ventas} eliminadas`);
    console.log(`   - Conversaciones: ${resultado.conversaciones} eliminadas`);
    console.log(`   - Pedidos: ${resultado.pedidos} eliminados`);
    console.log(`   - Cliente: 1 eliminado\n`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error durante la eliminación:`, error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

const clienteId = process.argv[2];
eliminarClienteHuerfano(clienteId);