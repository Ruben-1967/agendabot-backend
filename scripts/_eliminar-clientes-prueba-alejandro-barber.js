#!/usr/bin/env node
/**
 * Elimina TODOS los clientes de prueba de Alejandro Barber
 * (18ba4ab2-17bd-4044-b6f7-2859917de126) antes de que el negocio empiece a
 * operar en serio con el número real +56949528788 — confirmado con
 * _ver-clientes-prueba-alejandro-barber.js: 12 clientes, 10 citas,
 * 5 ventas, 3 conversaciones, 0 fichas/listaEspera/pedidos.
 *
 * Borra en orden (lo que depende del cliente primero, para no chocar con
 * las foreign keys): Cita, Venta, AtencionClinica, ListaEspera, Pedido,
 * Conversacion, y al final el propio Cliente. Todo en una transacción —
 * si algo falla, no queda nada a medias.
 *
 * Uso (Render Shell): node scripts/_eliminar-clientes-prueba-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = '18ba4ab2-17bd-4044-b6f7-2859917de126';

async function main() {
  const clientes = await prisma.cliente.findMany({ where: { empresaId: EMPRESA_ID }, select: { id: true, nombre: true } });
  if (clientes.length === 0) {
    console.log('No hay ningún cliente que eliminar.');
    return;
  }
  const ids = clientes.map((c) => c.id);

  const [citas, ventas, fichas, listaEspera, pedidos, conversaciones, borrados] = await prisma.$transaction([
    prisma.cita.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.venta.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.atencionClinica.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.listaEspera.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.pedido.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.conversacion.deleteMany({ where: { clienteId: { in: ids } } }),
    prisma.cliente.deleteMany({ where: { id: { in: ids } } }),
  ]);

  console.log(`Eliminados: ${citas.count} citas, ${ventas.count} ventas, ${fichas.count} fichas clínicas, ${listaEspera.count} lista de espera, ${pedidos.count} pedidos, ${conversaciones.count} conversaciones, ${borrados.count} clientes.`);
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
