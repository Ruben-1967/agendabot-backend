#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: estado completo de "Alejandro Barber" —
 * ¿tiene WhatsApp conectado? ¿suscripción activa? ¿agenda configurada
 * (recurso, horario, servicios)? Para saber si el bot ya respondería o
 * qué falta.
 *
 * Uso (Shell de Render, producción): node scripts/_ver-estado-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    include: {
      rubroTemplate: true,
      suscripcion: true,
      recursos: { include: { horarios: true } },
      servicios: true,
      usuarios: { select: { nombre: true, email: true, rol: true, tokenActivacion: true, fechaActivacionCuenta: true } },
    },
  });

  if (!empresa) {
    console.log('No se encontró ninguna empresa con "Barber" en el nombre.');
    await prisma.$disconnect();
    return;
  }

  console.log(`=== ${empresa.nombre} (id=${empresa.id}) ===\n`);

  console.log('--- WhatsApp ---');
  console.log(`whatsappNumeroId: ${empresa.whatsappNumeroId || '(sin conectar)'}`);
  console.log(`whatsappWabaId: ${empresa.whatsappWabaId || '-'}`);
  console.log(`whatsappPhoneNumber: ${empresa.whatsappPhoneNumber || '-'}`);
  console.log(`whatsappToken presente: ${empresa.whatsappToken ? 'sí' : 'no'}`);

  console.log('\n--- Suscripción ---');
  if (empresa.suscripcion) {
    console.log(`estado: ${empresa.suscripcion.estado} | plan: ${empresa.suscripcion.plan}`);
  } else {
    console.log('Sin Suscripcion asociada.');
  }
  console.log(`pruebahasta: ${empresa.pruebahasta ? empresa.pruebahasta.toISOString() : '(sin prueba)'}`);
  console.log(`bloqueadaPorPruebaVencida: ${empresa.bloqueadaPorPruebaVencida}`);

  console.log('\n--- Agenda ---');
  if (empresa.recursos.length === 0) {
    console.log('Sin ningún RecursoAgendable creado.');
  } else {
    empresa.recursos.forEach((r) => {
      console.log(`Recurso: ${r.nombre} | duración=${r.duracionCitaMinutos}min | horarios cargados: ${r.horarios.length}`);
    });
  }
  console.log(`Servicios cargados: ${empresa.servicios.length}${empresa.servicios.length ? ' -> ' + empresa.servicios.map(s => s.nombre).join(', ') : ''}`);

  console.log('\n--- Usuarios del panel ---');
  empresa.usuarios.forEach((u) => {
    console.log(`${u.nombre} (${u.email}, ${u.rol}) | activada: ${u.fechaActivacionCuenta ? 'sí' : 'no'} | token pendiente: ${u.tokenActivacion ? 'sí' : 'no'}`);
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
