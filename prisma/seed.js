// Siembra inicial de datos: plantillas por rubro + Ahorróptica como primer cliente
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // ------------------------------------------------------------
  // Plantillas de rubro
  // ------------------------------------------------------------
  const optica = await prisma.rubroTemplate.upsert({
    where: { clave: 'optica' },
    update: {},
    create: {
      clave: 'optica',
      nombre: 'Óptica',
      camposFicha: {
        receta: {
          od: { esfera: 'number', cilindro: 'number', eje: 'number', adicion: 'number' },
          oi: { esfera: 'number', cilindro: 'number', eje: 'number', adicion: 'number' },
          dp: 'number',
          diagnostico: 'text',
          emitidaPor: 'text',
          fecha: 'date'
        }
      },
      serviciosBase: ['Examen de la vista', 'Control anual', 'Adaptación lentes de contacto'],
      automatizacionesBase: ['recordatorio_24h', 'lista_espera_automatica', 'encuesta_satisfaccion', 'recordatorio_control_anual']
    }
  });

  const centroEstetico = await prisma.rubroTemplate.upsert({
    where: { clave: 'centro_estetico' },
    update: {},
    create: {
      clave: 'centro_estetico',
      nombre: 'Centro estético',
      camposFicha: {
        alergias: 'text',
        tipoPiel: 'text',
        tratamientoActivo: { nombre: 'text', sesionActual: 'number', totalSesiones: 'number' }
      },
      serviciosBase: ['Limpieza facial', 'Radiofrecuencia', 'Depilación láser'],
      automatizacionesBase: ['recordatorio_24h', 'lista_espera_automatica', 'encuesta_satisfaccion', 'recordatorio_proxima_sesion']
    }
  });

  const saludIndependiente = await prisma.rubroTemplate.upsert({
    where: { clave: 'salud_independiente' },
    update: {},
    create: {
      clave: 'salud_independiente',
      nombre: 'Salud independiente',
      camposFicha: {
        notasSesion: 'text',
        planTratamiento: 'text'
      },
      serviciosBase: ['Sesión de evaluación', 'Control'],
      automatizacionesBase: ['recordatorio_24h', 'lista_espera_automatica', 'encuesta_satisfaccion']
    }
  });

  const mantencionTecnica = await prisma.rubroTemplate.upsert({
    where: { clave: 'mantencion_tecnica' },
    update: {},
    create: {
      clave: 'mantencion_tecnica',
      nombre: 'Mantención técnica',
      camposFicha: {
        equipo: { marca: 'text', modelo: 'text', numeroSerie: 'text', garantiaHasta: 'date' }
      },
      serviciosBase: ['Mantención preventiva', 'Visita de urgencia'],
      automatizacionesBase: ['recordatorio_24h', 'recordatorio_mantencion_semestral']
    }
  });

  await prisma.rubroTemplate.upsert({
    where: { clave: 'otro' },
    update: {},
    create: {
      clave: 'otro',
      nombre: 'Otro rubro',
      camposFicha: {},
      serviciosBase: [],
      automatizacionesBase: ['recordatorio_24h']
    }
  });

  // ------------------------------------------------------------
  // Ahorróptica — primer cliente real, bajo Plan Inicio (legacy)
  // ------------------------------------------------------------
  const ahoroptica = await prisma.empresa.upsert({
    where: { id: 'ahoroptica-lautaro-seed-id' },
    update: {},
    create: {
      id: 'ahoroptica-lautaro-seed-id',
      nombre: 'Ahorróptica',
      sucursal: 'Sucursal Lautaro',
      rubroTemplateId: optica.id
    }
  });

  await prisma.suscripcion.upsert({
    where: { empresaId: ahoroptica.id },
    update: {},
    create: {
      empresaId: ahoroptica.id,
      plan: 'PLAN_INICIO_LEGACY',
      estado: 'PENDIENTE_PAGO',
      montoMensualActual: 29900,
      citasIncluidas: 100,
      precioCitaExcedente: 350,
      fechaProximoCobro: new Date(),
      fechaProximoCobroHosting: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    }
  });

  // ------------------------------------------------------------
  // LuxVision — segundo tenant, usado para PROBAR el motor de
  // disponibilidad y agendamiento con datos reales de horario.
  // ------------------------------------------------------------
  const luxvision = await prisma.empresa.upsert({
    where: { id: 'luxvision-seed-id' },
    update: {},
    create: {
      id: 'luxvision-seed-id',
      nombre: 'LuxVision',
      rubroTemplateId: optica.id
    }
  });

  const recursoLuxVision = await prisma.recursoAgendable.upsert({
    where: { id: 'luxvision-recurso-seed-id' },
    update: {},
    create: {
      id: 'luxvision-recurso-seed-id',
      empresaId: luxvision.id,
      nombre: 'Optómetra LuxVision',
      tipo: 'profesional',
      duracionCitaMinutos: 30,
      anticipacionMinimaMin: 120,
      horizonteAgendaDias: 28
    }
  });

  // Horario real: Lunes(1), Miércoles(3), Viernes(5) 10:00-13:30 y 14:30-19:00.
  // Sábado(6) 10:00-14:00.
  const bloquesHorario = [
    { diaSemana: 1, horaInicio: '10:00', horaFin: '13:30' },
    { diaSemana: 1, horaInicio: '14:30', horaFin: '19:00' },
    { diaSemana: 3, horaInicio: '10:00', horaFin: '13:30' },
    { diaSemana: 3, horaInicio: '14:30', horaFin: '19:00' },
    { diaSemana: 5, horaInicio: '10:00', horaFin: '13:30' },
    { diaSemana: 5, horaInicio: '14:30', horaFin: '19:00' },
    { diaSemana: 6, horaInicio: '10:00', horaFin: '14:00' }
  ];

  for (const bloque of bloquesHorario) {
    const idDeterministico = `luxvision-horario-${bloque.diaSemana}-${bloque.horaInicio}`;
    await prisma.horarioSemanal.upsert({
      where: { id: idDeterministico },
      update: {},
      create: {
        id: idDeterministico,
        recursoAgendableId: recursoLuxVision.id,
        diaSemana: bloque.diaSemana,
        horaInicio: bloque.horaInicio,
        horaFin: bloque.horaFin,
        activo: true
      }
    });
  }

  const serviciosLuxVision = ['Examen de la vista', 'Control anual', 'Adaptación lentes de contacto'];
  for (const nombreServicio of serviciosLuxVision) {
    const idDeterministico = `luxvision-servicio-${nombreServicio.toLowerCase().replace(/\s+/g, '-')}`;
    await prisma.servicio.upsert({
      where: { id: idDeterministico },
      update: {},
      create: {
        id: idDeterministico,
        empresaId: luxvision.id,
        nombre: nombreServicio,
        duracionMinutos: 30
      }
    });
  }

  console.log('Seed completo: rubros, Ahorróptica y LuxVision (con horario y servicios) cargados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
