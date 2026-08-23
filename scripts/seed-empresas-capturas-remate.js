/**
 * Empresas ficticias (esDemo: true) para que Ruben capture desde su
 * celular las pantallas curadas del remate de venta por rubro (ver
 * src/config/remateDemoPanel.js). Cada una viene poblada con datos de
 * ejemplo evidentemente ficticios, pensados para que la pantalla asignada
 * se vea "en uso" real al capturarla — no en blanco.
 *
 * Mapeo rubro -> pantalla a capturar (decidido con Ruben):
 *   Óptica, Salud Privada                                   -> Pacientes/clientes
 *   Belleza/Estética, Servicios Profesionales, Construcción -> Configuración de agenda
 *   Gastronomía-Reservas, Creatividad/Marketing, Otro       -> Panel inicial (dashboard)
 *
 * Estas empresas NO se borran al terminar — quedan intencionalmente hasta
 * que Ruben termine de capturar las 8 pantallas y reemplace los
 * placeholders en assets/demo-panel/. Se accede igual que a cualquier
 * empresa demo: login normal en el panel con el email/password que
 * imprime este script al final.
 *
 * Uso: node scripts/seed-empresas-capturas-remate.js
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

const PASSWORD_COMUN = 'Captura2026!';

const HORARIO_LUN_VIE_9_18 = [1, 2, 3, 4, 5].map((dia) => ({ diaSemana: dia, horaInicio: '09:00', horaFin: '18:00' }));
const HORARIO_LUN_SAB_8_17 = [1, 2, 3, 4, 5, 6].map((dia) => ({ diaSemana: dia, horaInicio: '08:00', horaFin: dia === 6 ? '13:00' : '17:00' }));
const HORARIO_TODOS_12_23 = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ diaSemana: dia, horaInicio: '12:00', horaFin: '23:00' }));

function enDias(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function hoyALasHoras(horas, minutos = 0) {
  const d = new Date();
  d.setHours(horas, minutos, 0, 0);
  return d;
}

const EMPRESAS = [
  {
    clave: 'optica',
    nombreEmpresa: 'Óptica Horizonte Claro',
    emailAdmin: 'admin@opticahorizonteclaro-demo.cl',
    nombreRecurso: 'Dra. Marcela Ibáñez (Optometrista)',
    horario: HORARIO_LUN_VIE_9_18,
    servicios: [{ nombre: 'Examen de la vista', duracionMinutos: 30 }, { nombre: 'Control de lentes de contacto', duracionMinutos: 20 }],
    tipoPantalla: 'pacientes',
    clientes: [
      { nombre: 'Marcela Vidal Contreras', telefono: '56900000101', fichaJson: { od: { esfera: -1.5, cilindro: -0.5, eje: 90, adicion: 1 }, oi: { esfera: -1.25, cilindro: -0.25, eje: 85 }, dp: '62' }, proximaVisitaEnDias: 5 },
      { nombre: 'Tomás Reyes Pizarro', telefono: '56900000102', fichaJson: { od: { esfera: -2.0, cilindro: -0.75, eje: 100 }, oi: { esfera: -2.25 }, dp: '64' }, proximaVisitaEnDias: 12 },
      { nombre: 'Francisca Soto Lira', telefono: '56900000103', fichaJson: { od: { esfera: 1.0 }, oi: { esfera: 1.25 }, dp: '60' }, proximaVisitaEnDias: null },
      { nombre: 'Ignacio Paredes Toro', telefono: '56900000104', fichaJson: { od: { esfera: -0.5, cilindro: -1.0, eje: 15 }, oi: { esfera: -0.75, cilindro: -1.0, eje: 170 }, dp: '65' }, proximaVisitaEnDias: 20 },
    ],
  },
  {
    clave: 'salud_privada',
    nombreEmpresa: 'Centro Médico Vitalia',
    emailAdmin: 'admin@centrovitalia-demo.cl',
    nombreRecurso: 'Dr. Rodrigo Fuentes (Medicina General)',
    horario: HORARIO_LUN_VIE_9_18,
    servicios: [{ nombre: 'Consulta medicina general', duracionMinutos: 30 }, { nombre: 'Control crónico', duracionMinutos: 20 }],
    tipoPantalla: 'pacientes',
    clientes: [
      { nombre: 'Beatriz Contreras Muñoz', telefono: '56900000201', fichaJson: { medicamentosActuales: 'Losartán 50mg, Metformina 850mg', antecedentesRelevantes: 'Hipertensión, diabetes tipo 2', profesionalResponsable: 'Dr. Rodrigo Fuentes' }, proximaVisitaEnDias: 3 },
      { nombre: 'Sergio Molina Aravena', telefono: '56900000202', fichaJson: { medicamentosActuales: 'Atorvastatina 20mg', antecedentesRelevantes: 'Colesterol alto', profesionalResponsable: 'Dr. Rodrigo Fuentes' }, proximaVisitaEnDias: 15 },
      { nombre: 'Camila Bravo Sepúlveda', telefono: '56900000203', fichaJson: { medicamentosActuales: 'Ninguno', antecedentesRelevantes: 'Sin antecedentes relevantes', profesionalResponsable: 'Dr. Rodrigo Fuentes' }, proximaVisitaEnDias: null },
      { nombre: 'Álvaro Yáñez Cortés', telefono: '56900000204', fichaJson: { medicamentosActuales: 'Salbutamol inhalador', antecedentesRelevantes: 'Asma bronquial', profesionalResponsable: 'Dr. Rodrigo Fuentes' }, proximaVisitaEnDias: 30 },
    ],
  },
  {
    clave: 'belleza_estetica_bienestar',
    nombreEmpresa: 'Estudio Bella Piel',
    emailAdmin: 'admin@estudiobellapiel-demo.cl',
    nombreRecurso: 'Cosmetóloga Andrea Muñoz',
    horario: [1, 2, 3, 4, 5, 6].map((dia) => ({ diaSemana: dia, horaInicio: '10:00', horaFin: dia === 6 ? '15:00' : '19:00' })),
    servicios: [{ nombre: 'Limpieza facial profunda', duracionMinutos: 60 }, { nombre: 'Masaje relajante', duracionMinutos: 50 }],
    tipoPantalla: 'agenda',
    bloqueo: { motivo: 'Vacaciones de verano', inicioEnDias: 40, finEnDias: 47 },
  },
  {
    clave: 'servicios_profesionales',
    nombreEmpresa: 'Asesorías Contables Rivas & Asociados',
    emailAdmin: 'admin@rivasasociados-demo.cl',
    nombreRecurso: 'Contador Felipe Rivas',
    horario: HORARIO_LUN_VIE_9_18,
    servicios: [{ nombre: 'Asesoría tributaria', duracionMinutos: 45 }, { nombre: 'Constitución de empresa', duracionMinutos: 60 }],
    tipoPantalla: 'agenda',
    bloqueo: { motivo: 'Capacitación SII', inicioEnDias: 10, finEnDias: 10 },
  },
  {
    clave: 'construccion_mantenimiento',
    nombreEmpresa: 'Mantenciones Técnicas Andes',
    emailAdmin: 'admin@mantencionesandes-demo.cl',
    nombreRecurso: 'Técnico Jorge Salinas',
    horario: HORARIO_LUN_SAB_8_17,
    servicios: [{ nombre: 'Mantención de calefont', duracionMinutos: 40 }, { nombre: 'Revisión eléctrica', duracionMinutos: 60 }],
    tipoPantalla: 'agenda',
    bloqueo: { motivo: 'Feriado irrenunciable', inicioEnDias: 18, finEnDias: 18 },
  },
  {
    clave: 'gastronomia_reservas',
    nombreEmpresa: 'Restaurante Costa Azul',
    emailAdmin: 'admin@costaazul-demo.cl',
    nombreRecurso: 'Salón Principal',
    horario: HORARIO_TODOS_12_23,
    servicios: [{ nombre: 'Reserva de mesa', duracionMinutos: 90 }],
    tipoPantalla: 'dashboard',
    clientesDashboard: [
      { nombre: 'Paula Herrera Díaz', telefono: '56900000301' },
      { nombre: 'Cristóbal Navarro Reyes', telefono: '56900000302' },
      { nombre: 'Javiera Rojas Valdés', telefono: '56900000303' },
    ],
    citasHoy: [
      { horas: 13, minutos: 0, estado: 'CONFIRMADA' },
      { horas: 14, minutos: 30, estado: 'PENDIENTE' },
      { horas: 20, minutos: 0, estado: 'CONFIRMADA' },
    ],
  },
  {
    clave: 'creatividad_marketing',
    nombreEmpresa: 'Agencia Creativa Pixel Norte',
    emailAdmin: 'admin@pixelnorte-demo.cl',
    nombreRecurso: 'Reuniones de Agencia',
    horario: HORARIO_LUN_VIE_9_18,
    servicios: [{ nombre: 'Reunión de propuesta', duracionMinutos: 45 }],
    tipoPantalla: 'dashboard',
    clientesDashboard: [
      { nombre: 'Matías Cárdenas Poblete', telefono: '56900000401' },
      { nombre: 'Valentina Órdenes Silva', telefono: '56900000402' },
    ],
    citasHoy: [
      { horas: 10, minutos: 0, estado: 'CONFIRMADA' },
      { horas: 16, minutos: 30, estado: 'PENDIENTE' },
    ],
  },
  {
    clave: 'otro',
    nombreEmpresa: 'Taller Mecánico El Motor',
    emailAdmin: 'admin@tallerelmotor-demo.cl',
    nombreRecurso: 'Box Mecánico 1',
    horario: HORARIO_LUN_SAB_8_17,
    servicios: [{ nombre: 'Cambio de aceite', duracionMinutos: 30 }, { nombre: 'Revisión de frenos', duracionMinutos: 45 }],
    tipoPantalla: 'dashboard',
    clientesDashboard: [
      { nombre: 'Patricio Guajardo Leiva', telefono: '56900000501' },
      { nombre: 'Fernanda Castro Muñoz', telefono: '56900000502' },
      { nombre: 'Diego Espinoza Vera', telefono: '56900000503' },
    ],
    citasHoy: [
      { horas: 9, minutos: 30, estado: 'CONFIRMADA' },
      { horas: 11, minutos: 0, estado: 'CONFIRMADA' },
      { horas: 15, minutos: 0, estado: 'PENDIENTE' },
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD_COMUN, 10);
  const credenciales = [];

  for (const config of EMPRESAS) {
    const rubro = await prisma.rubroTemplate.findUnique({ where: { clave: config.clave } });
    if (!rubro) throw new Error(`No existe RubroTemplate con clave ${config.clave}`);

    const empresa = await prisma.empresa.create({
      data: { nombre: config.nombreEmpresa, rubroTemplateId: rubro.id, esDemo: true },
    });

    await prisma.usuario.create({
      data: { empresaId: empresa.id, nombre: 'Admin Demo', email: config.emailAdmin, passwordHash, rol: 'ADMIN' },
    });

    const recurso = await prisma.recursoAgendable.create({
      data: { empresaId: empresa.id, nombre: config.nombreRecurso },
    });

    for (const h of config.horario) {
      await prisma.horarioSemanal.create({
        data: { recursoAgendableId: recurso.id, diaSemana: h.diaSemana, horaInicio: h.horaInicio, horaFin: h.horaFin },
      });
    }

    const servicios = [];
    for (const s of config.servicios) {
      const servicio = await prisma.servicio.create({
        data: { empresaId: empresa.id, nombre: s.nombre, duracionMinutos: s.duracionMinutos },
      });
      servicios.push(servicio);
      await prisma.servicioRecurso.create({ data: { servicioId: servicio.id, recursoAgendableId: recurso.id } });
    }

    if (config.tipoPantalla === 'pacientes') {
      for (const c of config.clientes) {
        await prisma.cliente.create({
          data: {
            empresaId: empresa.id,
            nombre: c.nombre,
            telefono: c.telefono,
            fichaJson: c.fichaJson,
            fechaProximaCita: c.proximaVisitaEnDias !== null ? enDias(c.proximaVisitaEnDias) : null,
          },
        });
      }
    }

    if (config.tipoPantalla === 'agenda' && config.bloqueo) {
      await prisma.bloqueo.create({
        data: {
          recursoAgendableId: recurso.id,
          fechaInicio: enDias(config.bloqueo.inicioEnDias),
          fechaFin: enDias(config.bloqueo.finEnDias),
          motivo: config.bloqueo.motivo,
        },
      });
    }

    if (config.tipoPantalla === 'dashboard') {
      const clientesCreados = [];
      for (const c of config.clientesDashboard) {
        const cliente = await prisma.cliente.create({
          data: { empresaId: empresa.id, nombre: c.nombre, telefono: c.telefono },
        });
        clientesCreados.push(cliente);
      }

      for (let i = 0; i < config.citasHoy.length; i++) {
        const citaConfig = config.citasHoy[i];
        const cliente = clientesCreados[i % clientesCreados.length];
        const inicio = hoyALasHoras(citaConfig.horas, citaConfig.minutos);
        const fin = new Date(inicio.getTime() + (servicios[0]?.duracionMinutos || 30) * 60000);
        await prisma.cita.create({
          data: {
            empresaId: empresa.id,
            clienteId: cliente.id,
            recursoAgendableId: recurso.id,
            servicioId: servicios[0]?.id || null,
            fechaHoraInicio: inicio,
            fechaHoraFin: fin,
            estado: citaConfig.estado,
          },
        });
      }
    }

    credenciales.push({ empresa: config.nombreEmpresa, pantalla: config.tipoPantalla, email: config.emailAdmin });
    console.log(`Creada: ${config.nombreEmpresa} (${config.tipoPantalla}) — empresaId=${empresa.id}`);
  }

  console.log('\n=== Credenciales de acceso (mismo panel de siempre) ===');
  console.log(`Contraseña (igual para las 8): ${PASSWORD_COMUN}\n`);
  for (const c of credenciales) {
    console.log(`${c.email}  ->  ${c.empresa}  [pantalla a capturar: ${c.pantalla}]`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
