#!/usr/bin/env node
// Uso puntual, SOLO STAGING: resuelve las citas PENDIENTE/CONFIRMADA que se
// solapan entre sí para el mismo recursoAgendableId -- data de prueba/demo
// generada en bloque que bloquea la creación del EXCLUDE constraint contra
// doble reserva (ver crearCita() en disponibilidad.js). Nunca correr esto
// contra producción sin auditar cada caso a mano primero.
//
// Estrategia: por cada recursoAgendableId, ordena las citas por
// fechaHoraInicio y luego por creadoEn (la más antigua gana). Recorre en
// orden y va "reservando" el rango de cada una -- si la siguiente se
// solapa con algo ya reservado, la marca para cancelar (estado=CANCELADA,
// nunca delete, para no perder el registro).
//
// USO (dry-run por defecto, no escribe nada):
//   node scripts/_limpieza-citas-solapadas-staging.js
// USO (aplica los cambios de verdad):
//   APLICAR=1 node scripts/_limpieza-citas-solapadas-staging.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const aplicar = process.env.APLICAR === '1';

  const citas = await prisma.cita.findMany({
    where: { estado: { in: ['PENDIENTE', 'CONFIRMADA'] } },
    orderBy: [{ recursoAgendableId: 'asc' }, { fechaHoraInicio: 'asc' }, { creadoEn: 'asc' }],
    include: { empresa: { select: { nombre: true } }, cliente: { select: { nombre: true } } },
  });

  const porRecurso = new Map();
  for (const c of citas) {
    if (!porRecurso.has(c.recursoAgendableId)) porRecurso.set(c.recursoAgendableId, []);
    porRecurso.get(c.recursoAgendableId).push(c);
  }

  const aCancelar = [];
  for (const [recursoId, lista] of porRecurso) {
    const reservados = []; // rangos ya "ganadores" para este recurso
    for (const c of lista) {
      const inicio = c.fechaHoraInicio.getTime();
      const fin = c.fechaHoraFin.getTime();
      const chocaConAlguno = reservados.some((r) => inicio < r.fin && fin > r.inicio);
      if (chocaConAlguno) {
        aCancelar.push(c);
      } else {
        reservados.push({ inicio, fin });
      }
    }
  }

  console.log(`Total citas activas revisadas: ${citas.length}`);
  console.log(`Citas a cancelar por solapamiento: ${aCancelar.length}\n`);

  for (const c of aCancelar) {
    console.log(`  - ${c.id} | ${c.empresa.nombre} | ${c.cliente?.nombre || '(sin cliente)'} | ${c.fechaHoraInicio.toISOString()} → ${c.fechaHoraFin.toISOString()} | creada ${c.creadoEn.toISOString()}`);
  }

  if (!aplicar) {
    console.log('\n(dry-run, no se cambió nada -- correr con APLICAR=1 para cancelar estas citas de verdad)');
    return;
  }

  for (const c of aCancelar) {
    await prisma.cita.update({ where: { id: c.id }, data: { estado: 'CANCELADA' } });
  }
  console.log(`\n✅ ${aCancelar.length} citas marcadas como CANCELADA.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
