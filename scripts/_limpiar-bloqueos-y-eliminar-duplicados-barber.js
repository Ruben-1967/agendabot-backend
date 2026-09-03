#!/usr/bin/env node
/**
 * Segunda pasada de la limpieza de duplicados "Alejandro Barber": borra los
 * 2 registros puntuales que bloqueaban el borrado (confirmados como datos
 * de prueba, no de clientes reales — ver
 * _inspeccionar-bloqueos-duplicados-barber.js) y luego elimina las 2
 * empresas.
 *
 *  - DemoAsignada del +56 9 3335 3668 (demo abandonada en paso 0,
 *    2026-09-01, número de prueba de esta misma sesión) -> empresa
 *    c8730827-a4f2-4956-897e-aef26dd7a53e
 *  - Cliente + Conversacion "Luxvision Chile" (+56 9 2727 2707) -> el
 *    "Hola" de prueba mandado mientras el número estaba mal conectado a
 *    8f583c44-6ff9-4e52-aa92-820a0c199a45
 *
 * Uso (Render Shell): node scripts/_limpiar-bloqueos-y-eliminar-duplicados-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  await prisma.demoAsignada.deleteMany({ where: { empresaDemoId: 'c8730827-a4f2-4956-897e-aef26dd7a53e' } });
  console.log('DemoAsignada del +56 9 3335 3668 eliminada.');

  await prisma.conversacion.deleteMany({ where: { empresaId: '8f583c44-6ff9-4e52-aa92-820a0c199a45' } });
  await prisma.cliente.deleteMany({ where: { empresaId: '8f583c44-6ff9-4e52-aa92-820a0c199a45' } });
  console.log('Cliente/Conversacion "Luxvision Chile" eliminados.');

  for (const id of ['c8730827-a4f2-4956-897e-aef26dd7a53e', '8f583c44-6ff9-4e52-aa92-820a0c199a45']) {
    try {
      const empresa = await prisma.empresa.delete({ where: { id } });
      console.log(`${empresa.nombre} (${id}): eliminada.`);
    } catch (error) {
      console.error(`${id}: todavía no se pudo eliminar:`, error.message);
    }
  }
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
