#!/usr/bin/env node
// Uso puntual: revisa por qué una Cita puntual de Ahorróptica no recibió
// el recordatorio de confirmación automático -- muestra los campos
// relevantes (fechaHoraInicio, creadoEn, confirmacionIntentos,
// confirmacionUltimoEnvioEn, estado) y las horas exactas que el job
// calcularía, para comparar contra las condiciones reales de
// src/jobs/confirmarCitasProximas.js. Solo lectura.
//
// USO (Shell de Render, producción):
//   NOMBRE=<nombre o apellido a buscar> node scripts/_diagnostico-confirmacion-citas-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const HORAS_ANTES_PRIMER_INTENTO = 24;
const HORAS_MINIMAS_DESDE_CREACION = 24;

function horasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60);
}

async function main() {
  const nombreBuscado = process.env.NOMBRE;
  if (!nombreBuscado) {
    throw new Error('Falta NOMBRE -- correr como: NOMBRE="Ingrid" node scripts/_diagnostico-confirmacion-citas-ahoroptica.js');
  }

  const citas = await prisma.cita.findMany({
    where: {
      empresaId: EMPRESA_ID,
      cliente: { nombre: { contains: nombreBuscado, mode: 'insensitive' } },
    },
    include: { cliente: true },
    orderBy: { fechaHoraInicio: 'asc' },
  });

  if (citas.length === 0) {
    console.log(`No se encontró ninguna Cita (de ningún estado) con cliente que calce "${nombreBuscado}".`);
    const clientesParecidos = await prisma.cliente.findMany({
      where: { empresaId: EMPRESA_ID, nombre: { contains: nombreBuscado, mode: 'insensitive' } },
      select: { nombre: true, telefono: true },
      take: 5,
    });
    console.log(`Clientes con ese nombre (sin importar si tienen Cita): ${JSON.stringify(clientesParecidos)}`);
    return;
  }

  const ahora = new Date();

  for (const cita of citas) {
    const horasHastaCita = horasEntre(cita.fechaHoraInicio, ahora);
    const horasDesdeCreacion = horasEntre(ahora, cita.creadoEn);

    console.log('\n' + '='.repeat(60));
    console.log(`Cliente: ${cita.cliente.nombre} (tel: ${cita.cliente.telefono})`);
    console.log(`Estado de la cita: ${cita.estado}`);
    console.log(`Cita creada: ${cita.creadoEn.toISOString()} (hace ${horasDesdeCreacion.toFixed(1)}h)`);
    console.log(`Cita programada: ${cita.fechaHoraInicio.toISOString()} (en ${horasHastaCita.toFixed(1)}h)`);
    console.log(`confirmacionIntentos: ${cita.confirmacionIntentos}`);
    console.log(`confirmacionUltimoEnvioEn: ${cita.confirmacionUltimoEnvioEn ? cita.confirmacionUltimoEnvioEn.toISOString() : 'null'}`);
    console.log('-'.repeat(60));
    console.log(`¿horasHastaCita <= ${HORAS_ANTES_PRIMER_INTENTO}?  ${horasHastaCita <= HORAS_ANTES_PRIMER_INTENTO} (${horasHastaCita.toFixed(1)}h)`);
    console.log(`¿horasDesdeCreacion >= ${HORAS_MINIMAS_DESDE_CREACION}?  ${horasDesdeCreacion >= HORAS_MINIMAS_DESDE_CREACION} (${horasDesdeCreacion.toFixed(1)}h)`);
    if (cita.confirmacionIntentos === 0 && horasHastaCita <= HORAS_ANTES_PRIMER_INTENTO && horasDesdeCreacion < HORAS_MINIMAS_DESDE_CREACION) {
      console.log(`⚠️  BLOQUEADO: faltan ${(HORAS_MINIMAS_DESDE_CREACION - horasDesdeCreacion).toFixed(1)}h más desde la creación para que se cumpla la condición mínima.`);
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
