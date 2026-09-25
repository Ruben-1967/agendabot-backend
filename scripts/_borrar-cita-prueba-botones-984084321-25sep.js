#!/usr/bin/env node
// Uso puntual: borra el Cliente/Cita de PRUEBA creados por
// scripts/_crear-cita-prueba-botones-984084321-25sep.js una vez verificado
// el flujo de confirmación con botones. Solo toca el registro con id fijo
// 'prueba-984084321-ahoroptica-botones' y sus citas -- nunca borra nada
// más de ese teléfono (podría tener conversación/citas reales de sesiones
// anteriores con el mismo número de prueba).
//
// USO (Shell de Render, producción):
//   node scripts/_borrar-cita-prueba-botones-984084321-25sep.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const CLIENTE_ID = 'prueba-984084321-ahoroptica-botones';

async function main() {
  const citas = await prisma.cita.deleteMany({ where: { clienteId: CLIENTE_ID } });
  console.log(`✅ ${citas.count} cita(s) de prueba borrada(s).`);

  const cliente = await prisma.cliente.deleteMany({ where: { id: CLIENTE_ID } });
  console.log(`✅ ${cliente.count} cliente(s) de prueba borrado(s).`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
