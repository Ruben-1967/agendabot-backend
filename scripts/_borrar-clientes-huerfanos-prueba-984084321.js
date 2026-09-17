#!/usr/bin/env node
// Uso puntual: borra los 2 registros de Cliente ficticios que quedaron
// huérfanos tras la prueba en vivo de +56984084321 (Ahorróptica,
// 2026-09-17) y la limpieza de sus citas/conversación (ver
// scripts/_borrar-citas-y-conversacion-prueba-984084321.js). Ya no tienen
// ninguna Cita ni Conversacion vinculada -- solo quedaban como registros
// sueltos en el listado de clientes del negocio.
//
// Antes de borrar, revisa TODAS las relaciones reales de Cliente (citas,
// ventas, lista de espera, pedidos, atenciones clínicas, conversaciones) y
// aborta sin tocar nada si encuentra alguna -- nunca borra un Cliente con
// datos reales vinculados.
//
// Por defecto corre en modo DRY RUN. Borra de verdad con APLICAR=1.
//
// USO (Shell de Render, producción):
//   node scripts/_borrar-clientes-huerfanos-prueba-984084321.js          # dry run
//   APLICAR=1 node scripts/_borrar-clientes-huerfanos-prueba-984084321.js # borra de verdad

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const NOMBRES_FICTICIOS = ['Pedro Marín', 'Ximena Sánchez'];
const TELEFONOS_CONTACTO_FICTICIOS = ['912345678', '956756756'];
const APLICAR = process.env.APLICAR === '1';

async function main() {
  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId: EMPRESA_ID,
      OR: [
        { nombre: { in: NOMBRES_FICTICIOS } },
        { telefono: { in: TELEFONOS_CONTACTO_FICTICIOS } },
      ],
    },
  });

  if (clientes.length === 0) {
    console.log('No se encontró ningún Cliente que coincida -- nada que borrar.');
    return;
  }

  console.log(`Cliente(s) encontrados: ${clientes.length}`);
  let algunoConDatos = false;

  for (const c of clientes) {
    const [citas, conversaciones, ventas, listaEspera, pedidos, atenciones] = await Promise.all([
      prisma.cita.count({ where: { clienteId: c.id } }),
      prisma.conversacion.count({ where: { clienteId: c.id } }),
      prisma.venta.count({ where: { clienteId: c.id } }),
      prisma.listaEspera.count({ where: { clienteId: c.id } }),
      prisma.pedido.count({ where: { clienteId: c.id } }),
      prisma.atencionClinica.count({ where: { clienteId: c.id } }),
    ]);
    const totalRelaciones = citas + conversaciones + ventas + listaEspera + pedidos + atenciones;
    console.log(`  - ${c.id} -- "${c.nombre}" (telefono: ${c.telefono}) -- citas:${citas} conv:${conversaciones} ventas:${ventas} listaEspera:${listaEspera} pedidos:${pedidos} atenciones:${atenciones}`);
    if (totalRelaciones > 0) {
      algunoConDatos = true;
      console.log(`    ⚠️  tiene datos reales vinculados -- NO se va a borrar ninguno por seguridad.`);
    }
  }

  if (algunoConDatos) {
    console.log('\n❌ Abortado: al menos un Cliente tiene datos reales vinculados. Revisar a mano.');
    return;
  }

  if (!APLICAR) {
    console.log('\n(DRY RUN -- ninguno tiene datos vinculados, se pueden borrar. Volver a correr con APLICAR=1 para borrar de verdad.)');
    return;
  }

  const resultado = await prisma.cliente.deleteMany({
    where: { id: { in: clientes.map((c) => c.id) } },
  });
  console.log(`\n✅ ${resultado.count} Cliente(s) borrado(s).`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
