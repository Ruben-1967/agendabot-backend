#!/usr/bin/env node
// Prueba puntual: confirma que el EXCLUDE constraint sigue bloqueando el
// solapamiento NORMAL (esSobrecupo=false, protección real contra doble
// reserva) pero YA NO bloquea una cita marcada esSobrecupo=true, aunque se
// solape con otra existente en el mismo recurso y horario -- el bug real
// reportado por Ahorróptica (2026-09-23).
//
// Usa la Empresa DEMO (esDemo:true) y su primer RecursoAgendable, con 2
// Cliente/Cita de prueba con IDs fijos, limpiados en finally.
//
// Requiere haber corrido antes (en este mismo ambiente):
//   1. npx prisma db push               (agrega Cita.esSobrecupo)
//   2. node scripts/_migracion-permitir-sobrecupo-constraint.js
//
// USO (Shell de Render, Staging o producción):
//   node scripts/_probar-sobrecupo-constraint.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

let fallos = 0;
function assert(desc, cond) {
  console.log(`${cond ? '✅' : '⚠️ '} ${desc}`);
  if (!cond) fallos++;
}

const idsCreados = [];

async function main() {
  const empresa = await prisma.empresa.findFirst({ where: { esDemo: true } });
  if (!empresa) throw new Error('No se encontró ninguna Empresa DEMO.');
  const recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id } });
  if (!recurso) throw new Error('La Empresa DEMO no tiene ningún RecursoAgendable.');

  const inicio = new Date('2099-01-01T15:00:00.000Z'); // fecha lejana, imposible que choque con datos reales
  const fin = new Date(inicio.getTime() + 30 * 60 * 1000);

  const citaBase = await prisma.cita.create({
    data: {
      empresaId: empresa.id, recursoAgendableId: recurso.id,
      fechaHoraInicio: inicio, fechaHoraFin: fin,
      estado: 'PENDIENTE', origenCanal: 'panel',
      // clienteId es obligatorio -- reusamos cualquier Cliente de la empresa,
      // o creamos uno de prueba si no hay ninguno.
      clienteId: (await asegurarClientePrueba(empresa.id)).id,
    },
  });
  idsCreados.push(citaBase.id);
  console.log(`Cita base creada (${citaBase.id}), estado PENDIENTE, esSobrecupo=false.`);

  // 1. Intentar otra cita SOLAPADA, SIN esSobrecupo -- debe SEGUIR bloqueada.
  let bloqueadaNormal = false;
  try {
    const c = await prisma.cita.create({
      data: {
        empresaId: empresa.id, recursoAgendableId: recurso.id,
        fechaHoraInicio: inicio, fechaHoraFin: fin,
        estado: 'PENDIENTE', origenCanal: 'panel', esSobrecupo: false,
        clienteId: citaBase.clienteId,
      },
    });
    idsCreados.push(c.id);
  } catch (err) {
    bloqueadaNormal = err.message.includes('cita_no_solapa_horario');
  }
  assert('Cita solapada SIN esSobrecupo sigue bloqueada (protección real intacta)', bloqueadaNormal);

  // 2. La MISMA cita solapada, CON esSobrecupo=true -- debe permitirse.
  let sobrecupoOk = false;
  try {
    const c = await prisma.cita.create({
      data: {
        empresaId: empresa.id, recursoAgendableId: recurso.id,
        fechaHoraInicio: inicio, fechaHoraFin: fin,
        estado: 'PENDIENTE', origenCanal: 'panel', esSobrecupo: true,
        clienteId: citaBase.clienteId,
      },
    });
    idsCreados.push(c.id);
    sobrecupoOk = true;
  } catch (err) {
    console.log('   Error inesperado al forzar sobrecupo:', err.message);
  }
  assert('Cita solapada CON esSobrecupo=true SÍ se permite (bug corregido)', sobrecupoOk);

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s).`}`);
}

async function asegurarClientePrueba(empresaId) {
  let cliente = await prisma.cliente.findFirst({ where: { empresaId, telefono: '569000022255' } });
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId, telefono: '569000022255', nombre: 'Prueba sobrecupo' } });
    idsCreados.push(`cliente:${cliente.id}`);
  }
  return cliente;
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Borrar TODAS las Cita antes que cualquier Cliente (FK) -- sin importar
    // el orden en que se hayan agregado a idsCreados.
    for (const id of idsCreados) {
      if (!(typeof id === 'string' && id.startsWith('cliente:'))) {
        await prisma.cita.delete({ where: { id } }).catch(() => {});
      }
    }
    for (const id of idsCreados) {
      if (typeof id === 'string' && id.startsWith('cliente:')) {
        await prisma.cliente.delete({ where: { id: id.slice(8) } }).catch(() => {});
      }
    }
    console.log('🧹 Datos de prueba limpiados.');
    await prisma.$disconnect();
  });
