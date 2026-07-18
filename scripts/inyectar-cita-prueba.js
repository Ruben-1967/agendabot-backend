/**
 * Inyecta una Cita de prueba PENDIENTE, a N horas desde ahora — pensado para
 * probar el job de confirmación (src/jobs/confirmarCitasProximas.js) sin
 * tener que esperar una reserva real ni depender del horario de atención
 * del negocio.
 *
 * Uso:
 *   node scripts/inyectar-cita-prueba.js <empresaId> <telefono> [horasDesdeAhora=20]
 *
 * Ejemplo (Óptica Demo, cita en 20 horas — dispara el intento 1 en la
 * próxima corrida del cron, ya que está dentro de la ventana de 24h):
 *   node scripts/inyectar-cita-prueba.js b428408f-e347-4c1a-aae9-b70df7076fd1 56900000099 20
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const [empresaId, telefono, horasArg] = process.argv.slice(2);
  const horasDesdeAhora = horasArg ? Number(horasArg) : 20;

  if (!empresaId || !telefono) {
    console.error('Uso: node scripts/inyectar-cita-prueba.js <empresaId> <telefono> [horasDesdeAhora=20]');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.error(`No existe ninguna Empresa con id "${empresaId}"`);
    process.exit(1);
  }

  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId } });
  if (!recurso) {
    console.error(`La empresa "${empresa.nombre}" no tiene ningún RecursoAgendable configurado.`);
    process.exit(1);
  }

  const servicio = await prisma.servicio.findFirst({ where: { empresaId } });

  let cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono } });
  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: { empresaId, telefono, nombre: 'Cliente de prueba (recordatorio)' },
    });
  }

  const fechaHoraInicio = new Date(Date.now() + horasDesdeAhora * 60 * 60 * 1000);
  const fechaHoraFin = new Date(fechaHoraInicio.getTime() + recurso.duracionCitaMinutos * 60000);

  const cita = await prisma.cita.create({
    data: {
      empresaId,
      clienteId: cliente.id,
      recursoAgendableId: recurso.id,
      servicioId: servicio?.id || null,
      fechaHoraInicio,
      fechaHoraFin,
      estado: 'PENDIENTE',
      origenCanal: 'panel', // para distinguirla de una reserva real por whatsapp
    },
  });

  console.log('✅ Cita de prueba creada:');
  console.log({
    citaId: cita.id,
    empresa: empresa.nombre,
    cliente: cliente.nombre,
    telefono: cliente.telefono,
    fechaHoraInicio: cita.fechaHoraInicio.toISOString(),
    fechaHoraInicioChile: cita.fechaHoraInicio.toLocaleString('es-CL', { timeZone: 'America/Santiago' }),
    horasDesdeAhora,
  });
  console.log('\nEn la próxima corrida del cron (confirmarCitasProximas.js), esta cita debería recibir el intento 1 si horasDesdeAhora <= 24.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error inyectando cita de prueba:', err);
  process.exit(1);
});