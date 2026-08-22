// Borra una Empresa y absolutamente todo lo que depende de ella, en el
// orden correcto para no violar los foreign keys RESTRICT del schema (nada
// acá tiene onDelete: Cascade salvo HistorialSuscripcion, que se limpia
// solo). Pensado para limpiar empresas de PRUEBA convertidas durante
// testing — no está pensado para clientes reales con datos de producción
// que valga la pena conservar.
//
// DemoAsignada.empresaDemoId es la EXCEPCIÓN a "borrar todo lo que depende
// de esta empresa": no es una relación de dueño exclusivo como el resto de
// esta lista — es una plantilla de rubro que OTROS prospectos, sin
// relación con esta empresa, pueden estar usando ahora mismo para su
// propia conversación de demo. Borrar esas filas en cascada borraría
// conversaciones ajenas en curso, no datos de prueba de esta empresa. Por
// eso NO se cascade-borra: si hay otras demos activas usándola como
// plantilla, se rechaza el borrado con un error entendible (ver
// EMPRESA_ES_PLANTILLA_DEMO en el catch del endpoint que llama a esto).
//
// Debe llamarse dentro de un prisma.$transaction(async (tx) => ...).
async function eliminarEmpresaCompleta(tx, empresaId) {
  const empresaActual = await tx.empresa.findUnique({ where: { id: empresaId }, select: { demoOrigenId: true } });
  if (!empresaActual) {
    throw new Error('Empresa no encontrada');
  }

  // La propia DemoAsignada de la que esta empresa se originó (si vino de
  // una conversión) no cuenta como "otro prospecto" — esa se borra más
  // abajo, después de la empresa.
  const filtroExclusionPropia = empresaActual.demoOrigenId ? { id: { not: empresaActual.demoOrigenId } } : {};
  const otrosProspectosQueLaUsanComoPlantilla = await tx.demoAsignada.count({
    where: { empresaDemoId: empresaId, ...filtroExclusionPropia },
  });
  if (otrosProspectosQueLaUsanComoPlantilla > 0) {
    const error = new Error(
      `Esta empresa se está usando como plantilla de demo para ${otrosProspectosQueLaUsanComoPlantilla} prospecto(s) más — no se puede eliminar sin afectar esas conversaciones.`
    );
    error.code = 'EMPRESA_ES_PLANTILLA_DEMO';
    throw error;
  }

  // Nivel más profundo: filas que dependen de Cliente/RecursoAgendable/
  // Servicio/CampanaEnvio/Pedido/BilleteraCreditos/CatalogoCategoria, no de
  // Empresa directo.
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
  await tx.catalogoItem.deleteMany({ where: { empresaId } });

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
  await tx.catalogoCategoria.deleteMany({ where: { empresaId } });

  const suscripcion = await tx.suscripcion.findUnique({ where: { empresaId } });
  if (suscripcion) {
    await tx.pago.deleteMany({ where: { suscripcionId: suscripcion.id } });
    await tx.suscripcion.delete({ where: { id: suscripcion.id } });
  }

  await tx.empresa.delete({ where: { id: empresaId } });
}

// Traduce un error de FK RESTRICT (Prisma P2003, o el código Postgres crudo
// 23503/23001) a un mensaje entendible, para cualquier tabla que referencie
// a Empresa y que eliminarEmpresaCompleta todavía no sepa limpiar — para
// que un caso no contemplado nunca vuelva a mostrarle al usuario del panel
// el stack trace crudo de Prisma.
function traducirErrorRestriccionEmpresa(error) {
  const esRestriccionFK = error.code === 'P2003' || error.code === '23503' || error.code === '23001';
  if (!esRestriccionFK) return null;

  // Los nombres de constraint que genera Prisma siguen el patrón "Tabla_columna_fkey".
  const nombreConstraint = error.meta?.constraint || error.meta?.field_name || '';
  const tabla = String(nombreConstraint).split('_')[0] || null;

  return tabla
    ? `No se puede eliminar: esta empresa todavía tiene datos asociados en "${tabla}" que no se limpiaron automáticamente. Contacta a soporte técnico antes de reintentar.`
    : 'No se puede eliminar: esta empresa todavía tiene datos asociados que no se limpiaron automáticamente. Contacta a soporte técnico antes de reintentar.';
}

module.exports = { eliminarEmpresaCompleta, traducirErrorRestriccionEmpresa };
