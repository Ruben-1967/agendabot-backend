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

  console.log('Seed completo: rubros creados y Ahorróptica cargada como primer cliente.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
