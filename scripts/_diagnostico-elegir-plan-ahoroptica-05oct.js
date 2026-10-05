#!/usr/bin/env node
// Uso puntual: POST /suscripcion/elegir-plan respondió 500 para Ahorróptica
// (2026-10-05). Repite los MISMOS pasos de esa ruta, uno por uno, imprimiendo
// el error real de cada paso. Efectos reales (iguales a los de la ruta): crea
// el cliente en Flow si todavía no existe (y guarda flowCustomerId) y pide
// el link de registro de tarjeta. Si todo sale bien, imprime el link.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-elegir-plan-ahoroptica-05oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const flowClient = require('../src/services/flowClient');
const { PLANES: DETALLE_PLANES } = require('../src/services/contratoHtml');
const { obtenerPrecioVigente } = require('../src/lib/precioSuscripcion');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const PLAN = 'A';

async function paso(nombre, fn) {
  try {
    const r = await fn();
    console.log(`✅ ${nombre}`);
    return r;
  } catch (err) {
    console.error(`❌ FALLÓ en: ${nombre}`);
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

async function main() {
  const empresa = await paso('1. leer empresa (con emailContacto y usuarios ADMIN)', () =>
    prisma.empresa.findUnique({
      where: { id: EMPRESA_ID },
      select: { id: true, nombre: true, emailContacto: true, usuarios: { where: { rol: 'ADMIN' }, take: 1, select: { email: true } } },
    }));
  const emailEmpresa = empresa.emailContacto || empresa.usuarios[0]?.email;
  console.log(`   nombre="${empresa.nombre}" email=${emailEmpresa || '(SIN EMAIL)'}`);

  const suscripcion = await paso('2. leer suscripción', () => prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_ID } }));
  console.log(`   plan=${suscripcion.plan} flowCustomerId=${suscripcion.flowCustomerId || '(ninguno)'} promo=${suscripcion.precioPromoMonto}/${suscripcion.precioPromoFlowPlanId}`);

  const planEnum = `PLAN_${PLAN}`;
  const precio = await paso('3. calcular precio vigente', async () => obtenerPrecioVigente({ ...suscripcion, plan: planEnum }, DETALLE_PLANES[planEnum]));
  console.log(`   precio=${JSON.stringify(precio)}`);

  await paso('4. actualizar suscripción (plan + monto)', () =>
    prisma.suscripcion.update({ where: { empresaId: EMPRESA_ID }, data: { plan: planEnum, montoMensualActual: precio.monto } }));

  let flowCustomerId = suscripcion.flowCustomerId;
  if (!flowCustomerId) {
    const cliente = await paso('5. crear cliente en Flow', () =>
      flowClient.crearClienteFlow({ empresaId: EMPRESA_ID, nombreEmpresa: empresa.nombre, emailEmpresa }));
    flowCustomerId = cliente.customerId;
    console.log(`   customerId=${flowCustomerId}`);
    await paso('6. guardar flowCustomerId', () => prisma.suscripcion.update({ where: { empresaId: EMPRESA_ID }, data: { flowCustomerId } }));
  } else {
    console.log('5-6. ya tenía flowCustomerId, se reusa');
  }

  const registro = await paso('7. pedir link de registro de tarjeta a Flow', () =>
    flowClient.registrarTarjetaFlow({ customerId: flowCustomerId, empresaId: EMPRESA_ID, plan: PLAN }));

  console.log(`\nMonto que se cobrará: $${precio.monto}`);
  if (precio.monto === 9900) {
    console.log('\nLink para Diego:\n');
    console.log(registro.url);
  } else {
    console.log('⚠️  El monto NO es $9.900 -- no entregar el link.');
  }
}

main()
  .catch((err) => { console.error('❌ Error inesperado:', err.stack || err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
