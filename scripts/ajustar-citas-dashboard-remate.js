/**
 * Ajusta el volumen de citas de hoy en las 8 empresas de captura del
 * remate (ver seed-empresas-capturas-remate.js) a los números pedidos por
 * Ruben para que el Dashboard se vea más "impresionante" al capturarlo:
 *   - Óptica, Salud Privada, Belleza, Gastronomía-Reservas: 18 citas / 16 confirmadas
 *   - Servicios Profesionales, Construcción, Creatividad/Marketing: 7 citas / 6 confirmadas
 *   - Otro (Taller Mecánico El Motor): 11 citas / 9 confirmadas
 *
 * Borra las citas de HOY existentes de cada empresa y las vuelve a crear
 * desde cero con el conteo exacto pedido, cada 30 min desde la apertura,
 * reusando clientes existentes y creando los que falten (ficticios,
 * mismo patrón ya usado). El resto (total - confirmadas) queda PENDIENTE.
 *
 * Uso: node scripts/ajustar-citas-dashboard-remate.js
 */
const prisma = require('../src/lib/prisma');

function hoyALasHoras(horas, minutos = 0) {
  const d = new Date();
  d.setHours(horas, minutos, 0, 0);
  return d;
}

const NOMBRES_EXTRA = [
  'Valeria Muñoz Castro', 'Pedro Salazar Vidal', 'Antonia Reyes León', 'Cristian Herrera Soto',
  'Macarena Pizarro Díaz', 'Felipe Contreras Marín', 'Bárbara Sepúlveda Rojas', 'Gonzalo Bravo Núñez',
  'Trinidad Araya Fuentes', 'Esteban Morales Cid', 'Constanza Lagos Vega', 'Vicente Torres Campos',
  'Javiera Méndez Poblete', 'Rodrigo Cárcamo Ibarra', 'Fernanda Riquelme Soto', 'Andrés Godoy Palma',
  'Camila Fernández Rojo', 'Matías Aguilera Vidal',
];

const CONFIG = [
  { nombreEmpresa: 'Óptica Horizonte Claro', totalCitas: 18, confirmadas: 16, horaInicio: 9 },
  { nombreEmpresa: 'Centro Médico Vitalia', totalCitas: 18, confirmadas: 16, horaInicio: 9 },
  { nombreEmpresa: 'Estudio Bella Piel', totalCitas: 18, confirmadas: 16, horaInicio: 9 },
  { nombreEmpresa: 'Restaurante Costa Azul', totalCitas: 18, confirmadas: 16, horaInicio: 12 },
  { nombreEmpresa: 'Asesorías Contables Rivas & Asociados', totalCitas: 7, confirmadas: 6, horaInicio: 9 },
  { nombreEmpresa: 'Mantenciones Técnicas Andes', totalCitas: 7, confirmadas: 6, horaInicio: 9 },
  { nombreEmpresa: 'Agencia Creativa Pixel Norte', totalCitas: 7, confirmadas: 6, horaInicio: 9 },
  { nombreEmpresa: 'Taller Mecánico El Motor', totalCitas: 11, confirmadas: 9, horaInicio: 9 },
];

async function main() {
  for (const config of CONFIG) {
    const empresa = await prisma.empresa.findFirst({
      where: { nombre: config.nombreEmpresa },
      include: { clientes: true, recursos: true, servicios: true },
    });
    if (!empresa) throw new Error(`No se encontró la empresa "${config.nombreEmpresa}"`);

    // Borra las citas de hoy existentes para partir de cero con el conteo exacto.
    await prisma.cita.deleteMany({ where: { empresaId: empresa.id } });

    const recurso = empresa.recursos[0];
    const servicio = empresa.servicios[0];

    // Asegura suficientes clientes distintos: reusa los existentes y crea
    // los que falten con nombres ficticios nuevos, sin repetir los ya usados.
    let clientes = [...empresa.clientes];
    let idxNombreExtra = 0;
    while (clientes.length < config.totalCitas) {
      const nombre = NOMBRES_EXTRA[idxNombreExtra % NOMBRES_EXTRA.length] + (idxNombreExtra >= NOMBRES_EXTRA.length ? ` ${idxNombreExtra}` : '');
      idxNombreExtra++;
      const cliente = await prisma.cliente.create({
        data: { empresaId: empresa.id, nombre, telefono: null },
      });
      clientes.push(cliente);
    }

    // Marca como PENDIENTE una de cada tantas citas, repartidas (no todas al final).
    const noConfirmadas = config.totalCitas - config.confirmadas;
    const pasoPendiente = noConfirmadas > 0 ? Math.floor(config.totalCitas / noConfirmadas) : Infinity;

    for (let i = 0; i < config.totalCitas; i++) {
      const minutosDesdeInicio = i * 30;
      const inicio = hoyALasHoras(config.horaInicio, 0);
      inicio.setMinutes(inicio.getMinutes() + minutosDesdeInicio);
      const fin = new Date(inicio.getTime() + (servicio?.duracionMinutos || 30) * 60000);

      const esPendiente = noConfirmadas > 0 && (i + 1) % pasoPendiente === 0 && i / pasoPendiente < noConfirmadas;
      const estado = esPendiente ? 'PENDIENTE' : 'CONFIRMADA';

      await prisma.cita.create({
        data: {
          empresaId: empresa.id,
          clienteId: clientes[i % clientes.length].id,
          recursoAgendableId: recurso.id,
          servicioId: servicio?.id || null,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          estado,
        },
      });
    }

    const confirmadasReales = await prisma.cita.count({ where: { empresaId: empresa.id, estado: 'CONFIRMADA' } });
    const totalReales = await prisma.cita.count({ where: { empresaId: empresa.id } });
    console.log(`${config.nombreEmpresa}: ${totalReales} citas, ${confirmadasReales} confirmadas (pedido: ${config.totalCitas}/${config.confirmadas}).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
