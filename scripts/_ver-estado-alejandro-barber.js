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
  // Primero se listan TODAS las empresas que calzan con "Barber" — la
  // corrida anterior de este script agarró una empresa DEMO vacía en vez
  // de la real (hay más de una fila con "Barber" en el nombre: la demo
  // original del prospecto y la empresa real creada al convertirlo).
  const candidatas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    select: { id: true, nombre: true, esDemo: true, creadoEn: true },
  });
  console.log('Empresas que calzan con "Barber":');
  candidatas.forEach((c) => console.log(`- id=${c.id} nombre="${c.nombre}" esDemo=${c.esDemo} creadoEn=${c.creadoEn.toISOString()}`));
  console.log('');

  // La real es la que NO es demo (o, si hay varias no-demo, la más nueva).
  const real = candidatas.filter((c) => !c.esDemo).sort((a, b) => b.creadoEn - a.creadoEn)[0];
  if (!real) {
    console.log('Ninguna de las candidatas es una empresa real (todas esDemo=true).');
    await prisma.$disconnect();
    return;
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: real.id },
    include: {
      rubroTemplate: true,
      suscripcion: true,
      recursos: { include: { horarios: true } },
      servicios: true,
      usuarios: { select: { nombre: true, email: true, rol: true, tokenActivacion: true, fechaActivacionCuenta: true } },
    },
  });

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
