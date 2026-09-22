#!/usr/bin/env node
// Uso puntual: Diego (Ahorróptica) agendó el 2026-09-22 ~10:30am para el
// 2026-09-23 ~11:30am y reporta que el primer recordatorio de confirmación
// no llegó, pese a tener Empresa.horasMinimasConfirmacionCita = 0. A
// diferencia de scripts/_diagnostico-confirmacion-citas-ahoroptica.js (que
// tiene el minimo hardcodeado en 24, desactualizado), este lee el valor
// REAL configurado en la Empresa y también revisa si hay whatsappToken/
// whatsappNumeroId -- las dos condiciones que gatillan el intento 1 en
// src/jobs/confirmarCitasProximas.js. Solo lectura.
//
// USO (Shell de Render, producción):
//   NOMBRE=Diego node scripts/_diagnostico-recordatorio-cita-diego-22sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const HORAS_ANTES_PRIMER_INTENTO = 24;

function horasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60);
}

async function main() {
  const nombreBuscado = process.env.NOMBRE || 'Diego';

  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) {
    console.log('No se encontró la empresa.');
    return;
  }

  console.log(`Empresa: ${empresa.nombre}`);
  console.log(`horasMinimasConfirmacionCita (real, configurado en el panel): ${empresa.horasMinimasConfirmacionCita}`);
  console.log(`whatsappNumeroId: ${empresa.whatsappNumeroId || '(vacío -- BLOQUEARÍA TODO el job para esta empresa)'}`);
  console.log(`whatsappToken guardado: ${empresa.whatsappToken ? 'sí' : 'NO -- BLOQUEARÍA TODO el job para esta empresa'}`);

  const citas = await prisma.cita.findMany({
    where: {
      empresaId: EMPRESA_ID,
      cliente: { nombre: { contains: nombreBuscado, mode: 'insensitive' } },
    },
    include: { cliente: true },
    orderBy: { creadoEn: 'desc' },
    take: 5,
  });

  if (citas.length === 0) {
    console.log(`\nNo se encontró ninguna Cita con cliente que calce "${nombreBuscado}".`);
    return;
  }

  const ahora = new Date();
  console.log(`\nAhora (UTC): ${ahora.toISOString()}`);

  for (const cita of citas) {
    const horasHastaCita = horasEntre(cita.fechaHoraInicio, ahora);
    const horasDesdeCreacion = horasEntre(ahora, cita.creadoEn);

    console.log('\n' + '='.repeat(60));
    console.log(`Cliente: ${cita.cliente.nombre} (tel: ${cita.cliente.telefono})`);
    console.log(`Estado de la cita: ${cita.estado}`);
    console.log(`Cita creada: ${cita.creadoEn.toISOString()} (hace ${horasDesdeCreacion.toFixed(2)}h)`);
    console.log(`Cita programada: ${cita.fechaHoraInicio.toISOString()} (en ${horasHastaCita.toFixed(2)}h)`);
    console.log(`confirmacionIntentos: ${cita.confirmacionIntentos}`);
    console.log(`confirmacionUltimoEnvioEn: ${cita.confirmacionUltimoEnvioEn ? cita.confirmacionUltimoEnvioEn.toISOString() : 'null'}`);
    console.log('-'.repeat(60));

    const cumpleProximidad = horasHastaCita <= HORAS_ANTES_PRIMER_INTENTO && horasHastaCita > -1;
    const cumpleMinimoCreacion = horasDesdeCreacion >= empresa.horasMinimasConfirmacionCita;

    console.log(`¿horasHastaCita <= ${HORAS_ANTES_PRIMER_INTENTO} y > -1?  ${cumpleProximidad} (${horasHastaCita.toFixed(2)}h)`);
    console.log(`¿horasDesdeCreacion >= ${empresa.horasMinimasConfirmacionCita} (valor real configurado)?  ${cumpleMinimoCreacion} (${horasDesdeCreacion.toFixed(2)}h)`);

    if (cita.estado !== 'PENDIENTE') {
      console.log(`⚠️  La cita NO está en estado PENDIENTE (está en ${cita.estado}) -- el job la ignora directo, sin importar las horas.`);
    } else if (cita.confirmacionIntentos > 0) {
      console.log(`ℹ️  Ya tiene confirmacionIntentos=${cita.confirmacionIntentos} -- el intento 1 ya se mandó en algún momento; no es que nunca haya salido.`);
    } else if (cumpleProximidad && cumpleMinimoCreacion) {
      console.log(`✅  Debería haberse mandado ya. Si no llegó, el problema está en el envío mismo (plantilla no aprobada, token, o el cron job no corrió) -- no en las condiciones de tiempo.`);
    } else if (!cumpleProximidad) {
      console.log(`⏳  Todavía no toca -- falta que pasen ${(horasHastaCita - HORAS_ANTES_PRIMER_INTENTO).toFixed(2)}h más para entrar en la ventana de 24h antes de la cita.`);
    } else {
      console.log(`⏳  Bloqueado por el mínimo desde creación -- faltan ${(empresa.horasMinimasConfirmacionCita - horasDesdeCreacion).toFixed(2)}h más.`);
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
