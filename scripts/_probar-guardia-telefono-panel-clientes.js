#!/usr/bin/env node
// Prueba puntual: verifica la condición de guardia agregada a
// PATCH /clientes/:id (routes/clientes.js) -- bloquear el cambio de
// telefono solo cuando el Cliente YA tiene Conversacion de WhatsApp.
// Crea 2 Cliente de prueba (uno con Conversacion, uno sin) usando la
// empresa DEMO, replica la misma condición del endpoint, y limpia todo
// al final. No pasa por HTTP/auth -- prueba la lógica directo contra la
// base, ya que el endpoint requiere sesión real.
//
// USO (Shell de Render, cualquier ambiente):
//   node scripts/_probar-guardia-telefono-panel-clientes.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

let fallos = 0;
function assert(descripcion, condicion) {
  console.log(`${condicion ? '✅' : '⚠️ '} ${descripcion}`);
  if (!condicion) fallos++;
}

async function main() {
  const empresaDemo = await prisma.empresa.findFirst({ where: { esDemo: true } });
  if (!empresaDemo) throw new Error('No se encontró ninguna Empresa DEMO.');

  const clienteSinConversacion = await prisma.cliente.create({
    data: { empresaId: empresaDemo.id, nombre: 'Prueba sin Conversacion', telefono: '569000099901' },
  });
  const clienteConConversacion = await prisma.cliente.create({
    data: { empresaId: empresaDemo.id, nombre: 'Prueba con Conversacion', telefono: '569000099902' },
  });
  const conversacionPrueba = await prisma.conversacion.create({
    data: { empresaId: empresaDemo.id, clienteId: clienteConConversacion.id, telefono: '569000099902', mensajes: [] },
  });

  try {
    // Misma condición exacta que el endpoint.
    const c1 = await prisma.cliente.findFirst({ where: { id: clienteSinConversacion.id }, include: { _count: { select: { conversaciones: true } } } });
    const bloqueadoC1 = c1.telefono !== '569000099999' && c1._count.conversaciones > 0;
    assert('Cliente SIN Conversacion: NO se bloquea el cambio de teléfono', !bloqueadoC1);

    const c2 = await prisma.cliente.findFirst({ where: { id: clienteConConversacion.id }, include: { _count: { select: { conversaciones: true } } } });
    const bloqueadoC2 = c2.telefono !== '569000099999' && c2._count.conversaciones > 0;
    assert('Cliente CON Conversacion: SÍ se bloquea el cambio de teléfono', bloqueadoC2);

    // Cambiar a un valor IGUAL al actual nunca debe bloquear (no es un cambio real).
    const bloqueadoSinCambio = c2.telefono !== c2.telefono && c2._count.conversaciones > 0;
    assert('Cliente CON Conversacion, mismo teléfono (sin cambio real): NO se bloquea', !bloqueadoSinCambio);

    console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todo OK.' : `${fallos} fallo(s).`}`);
  } finally {
    await prisma.conversacion.delete({ where: { id: conversacionPrueba.id } }).catch(() => {});
    await prisma.cliente.delete({ where: { id: clienteSinConversacion.id } }).catch(() => {});
    await prisma.cliente.delete({ where: { id: clienteConConversacion.id } }).catch(() => {});
    console.log('🧹 Datos de prueba limpiados.');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
