// Borra una Empresa y absolutamente todo lo que depende de ella, en el
// orden correcto para no violar los foreign keys RESTRICT del schema (nada
// acá tiene onDelete: Cascade salvo HistorialSuscripcion, que se limpia
// solo). Pensado para limpiar empresas de PRUEBA convertidas durante
// testing — no está pensado para clientes reales con datos de producción
// que valga la pena conservar.
//
// Debe llamarse dentro de un prisma.$transaction(async (tx) => ...).
async function eliminarEmpresaCompleta(tx, empresaId) {
  // Nivel más profundo: filas que dependen de Cliente/RecursoAgendable/
  // Servicio/CampanaEnvio/Pedido/BilleteraCreditos, no de Empresa directo.
  await tx.atencionClinica.deleteMany({ where: { cliente: { empresaId } } });
  await tx.pedidoItem.deleteMany({ where: { pedido: { empresaId } } });
  await tx.pedido.deleteMany({ where: { empresaId } });
  await tx.cita.deleteMany({ where: { empresaId } });
  await tx.listaEspera.deleteMany({ where: { empresaId } });
  await tx.conversacion.deleteMany({ where: { empresaId } });
  await tx.venta.deleteMany({ where: { empresaId } });
  await tx.servicioRecurso.deleteMany({ where: { servicio: { empresaId } } });
  await tx.horarioSemanal.deleteMany({ where: { recurso: { empresaId } } });
  await tx.bloqueo.deleteMany({ where: { recurso: { empresaId } } });
  await tx.envioRealizado.deleteMany({ where: { campana: { empresaId } } });
  await tx.movimientoCredito.deleteMany({ where: { billetera: { empresaId } } });

  // Usuario tiene que borrarse antes que RecursoAgendable — Usuario.recursoAgendableId
  // apunta a RecursoAgendable (nullable, pero es RESTRICT igual).
  await tx.usuario.deleteMany({ where: { empresaId } });

  // Ahora sí, las tablas que Empresa referencia directo.
  await tx.cliente.deleteMany({ where: { empresaId } });
  await tx.recursoAgendable.deleteMany({ where: { empresaId } });
  await tx.servicio.deleteMany({ where: { empresaId } });
  await tx.producto.deleteMany({ where: { empresaId } });
  await tx.campanaEnvio.deleteMany({ where: { empresaId } });
  await tx.billeteraCreditos.deleteMany({ where: { empresaId } });
  await tx.ordenCompraCreditos.deleteMany({ where: { empresaId } });
  await tx.contratoAceptado.deleteMany({ where: { empresaId } });

  const suscripcion = await tx.suscripcion.findUnique({ where: { empresaId } });
  if (suscripcion) {
    await tx.pago.deleteMany({ where: { suscripcionId: suscripcion.id } });
    await tx.suscripcion.delete({ where: { id: suscripcion.id } });
  }

  await tx.empresa.delete({ where: { id: empresaId } });
}

module.exports = { eliminarEmpresaCompleta };
