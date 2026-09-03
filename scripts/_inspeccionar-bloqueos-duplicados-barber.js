#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: qué son exactamente los datos que están
 * bloqueando el borrado de las 2 empresas "Alejandro Barber" duplicadas
 * restantes — el DemoAsignada de c8730827... y el Cliente/Conversacion de
 * 8f583c44... — para decidir si es seguro limpiarlos antes de borrar.
 *
 * Uso (Render Shell): node scripts/_inspeccionar-bloqueos-duplicados-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  console.log('--- DemoAsignada de c8730827-a4f2-4956-897e-aef26dd7a53e ---');
  const demos = await prisma.demoAsignada.findMany({
    where: { empresaDemoId: 'c8730827-a4f2-4956-897e-aef26dd7a53e' },
  });
  demos.forEach((d) =>
    console.log({
      telefono: d.telefono,
      telefonoOriginal: d.telefonoOriginal,
      nombreProspecto: d.nombreProspecto,
      creadoEn: d.creadoEn,
      actualizadoEn: d.actualizadoEn,
      eliminadoEn: d.eliminadoEn,
      paso: d.paso,
    })
  );

  console.log('\n--- Cliente/Conversacion de 8f583c44-6ff9-4e52-aa92-820a0c199a45 ---');
  const clientes = await prisma.cliente.findMany({
    where: { empresaId: '8f583c44-6ff9-4e52-aa92-820a0c199a45' },
  });
  clientes.forEach((c) => console.log({ id: c.id, nombre: c.nombre, telefono: c.telefono, creadoEn: c.creadoEn }));

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: '8f583c44-6ff9-4e52-aa92-820a0c199a45' },
  });
  conversaciones.forEach((c) =>
    console.log({ id: c.id, telefono: c.telefono, totalMensajes: Array.isArray(c.mensajes) ? c.mensajes.length : 0, creadoEn: c.creadoEn })
  );

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
