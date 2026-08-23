/**
 * Complemento a seed-empresas-capturas-remate.js: el diseño del remate
 * cambió de "una pantalla distinta por rubro" a "Dashboard para los 8
 * rubros por igual". 3 de las 8 empresas ya tenían citas de hoy pobladas
 * (Restaurante Costa Azul, Agencia Creativa Pixel Norte, Taller Mecánico
 * El Motor) — este script agrega lo mismo a las 5 restantes (Óptica,
 * Salud, Belleza, Servicios Profesionales, Construcción), reusando sus
 * clientes existentes cuando ya los tenían.
 *
 * Uso: node scripts/agregar-dashboard-a-empresas-remate.js
 */
const prisma = require('../src/lib/prisma');

function hoyALasHoras(horas, minutos = 0) {
  const d = new Date();
  d.setHours(horas, minutos, 0, 0);
  return d;
}

const CONFIG = [
  {
    nombreEmpresa: 'Óptica Horizonte Claro',
    nombreServicio: 'Examen de la vista',
    clientesNuevos: [],
    citas: [{ horas: 10, minutos: 0, estado: 'CONFIRMADA' }, { horas: 12, minutos: 30, estado: 'PENDIENTE' }, { horas: 17, minutos: 0, estado: 'CONFIRMADA' }],
  },
  {
    nombreEmpresa: 'Centro Médico Vitalia',
    nombreServicio: 'Consulta medicina general',
    clientesNuevos: [],
    citas: [{ horas: 9, minutos: 30, estado: 'CONFIRMADA' }, { horas: 11, minutos: 0, estado: 'CONFIRMADA' }, { horas: 16, minutos: 0, estado: 'PENDIENTE' }],
  },
  {
    nombreEmpresa: 'Estudio Bella Piel',
    nombreServicio: 'Limpieza facial profunda',
    clientesNuevos: [
      { nombre: 'Daniela Vergara Muñoz', telefono: '56900000601' },
      { nombre: 'Carolina Espinoza Ruiz', telefono: '56900000602' },
      { nombre: 'Josefina Torres Beltrán', telefono: '56900000603' },
    ],
    citas: [{ horas: 10, minutos: 30, estado: 'CONFIRMADA' }, { horas: 13, minutos: 0, estado: 'CONFIRMADA' }, { horas: 18, minutos: 0, estado: 'PENDIENTE' }],
  },
  {
    nombreEmpresa: 'Asesorías Contables Rivas & Asociados',
    nombreServicio: 'Asesoría tributaria',
    clientesNuevos: [
      { nombre: 'Empresa Constructora Los Álamos SpA', telefono: '56900000701' },
      { nombre: 'Comercial Andrade Ltda.', telefono: '56900000702' },
    ],
    citas: [{ horas: 9, minutos: 0, estado: 'CONFIRMADA' }, { horas: 15, minutos: 30, estado: 'PENDIENTE' }],
  },
  {
    nombreEmpresa: 'Mantenciones Técnicas Andes',
    nombreServicio: 'Mantención de calefont',
    clientesNuevos: [
      { nombre: 'Constanza Riquelme Bustos', telefono: '56900000801' },
      { nombre: 'Héctor Villalobos Meza', telefono: '56900000802' },
      { nombre: 'Nicolás Fuentealba Ortiz', telefono: '56900000803' },
    ],
    citas: [{ horas: 9, minutos: 0, estado: 'CONFIRMADA' }, { horas: 11, minutos: 30, estado: 'CONFIRMADA' }, { horas: 14, minutos: 0, estado: 'PENDIENTE' }],
  },
];

async function main() {
  for (const config of CONFIG) {
    const empresa = await prisma.empresa.findFirst({
      where: { nombre: config.nombreEmpresa },
      include: { clientes: true, recursos: true, servicios: true },
    });
    if (!empresa) throw new Error(`No se encontró la empresa "${config.nombreEmpresa}"`);

    const recurso = empresa.recursos[0];
    const servicio = empresa.servicios.find((s) => s.nombre === config.nombreServicio) || empresa.servicios[0];

    let clientesDisponibles = empresa.clientes;
    if (config.clientesNuevos.length > 0) {
      clientesDisponibles = [];
      for (const c of config.clientesNuevos) {
        const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: c.nombre, telefono: c.telefono } });
        clientesDisponibles.push(cliente);
      }
    }

    for (let i = 0; i < config.citas.length; i++) {
      const citaConfig = config.citas[i];
      const cliente = clientesDisponibles[i % clientesDisponibles.length];
      const inicio = hoyALasHoras(citaConfig.horas, citaConfig.minutos);
      const fin = new Date(inicio.getTime() + (servicio?.duracionMinutos || 30) * 60000);
      await prisma.cita.create({
        data: {
          empresaId: empresa.id,
          clienteId: cliente.id,
          recursoAgendableId: recurso.id,
          servicioId: servicio?.id || null,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          estado: citaConfig.estado,
        },
      });
    }

    console.log(`${config.nombreEmpresa}: ${config.citas.length} citas de hoy agregadas (${config.clientesNuevos.length > 0 ? config.clientesNuevos.length + ' clientes nuevos' : 'reusando clientes existentes'}).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
