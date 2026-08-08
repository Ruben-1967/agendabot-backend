/**
 * Crea una cita de prueba REAL (no de demo) en la empresa de prueba
 * multi-profesional de staging, con un cliente que tiene un teléfono
 * válido para probar el link wa.me de cancelación.
 *
 * Uso (Shell de Render, agendabot-backend-staging):
 *   node scripts/crear-cita-prueba-whatsapp.js
 */
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'c5378e4a-561a-4916-8f3b-a2097967cef6';

async function main() {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
    if (!empresa) {
      console.error('No se encontró la empresa de prueba. Verifica el EMPRESA_ID.');
      process.exit(1);
    }

    const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: EMPRESA_ID } });
    if (!recurso) {
      console.error('Esta empresa no tiene ningún RecursoAgendable todavía.');
      process.exit(1);
    }

    const cliente = await prisma.cliente.create({
      data: {
        empresaId: EMPRESA_ID,
        nombre: 'Cliente Prueba WhatsApp',
        telefono: '+56912345678',
      },
    });

    const hoy = new Date();
    const inicio = new Date(hoy);
    inicio.setHours(15, 0, 0, 0);
    const fin = new Date(inicio.getTime() + (recurso.duracionCitaMinutos || 30) * 60000);

    const cita = await prisma.cita.create({
      data: {
        empresaId: EMPRESA_ID,
        clienteId: cliente.id,
        recursoAgendableId: recurso.id,
        fechaHoraInicio: inicio,
        fechaHoraFin: fin,
        estado: 'PENDIENTE',
        origenCanal: 'panel',
      },
    });

    console.log('Cita de prueba creada:');
    console.log('citaId:', cita.id);
    console.log('cliente:', cliente.nombre, '/ telefono:', cliente.telefono);
    console.log('recurso:', recurso.nombre);
    console.log('hora:', inicio.toLocaleString('es-CL'));
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();