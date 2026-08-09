/**
 * Fixture temporal para probar el flujo de conversión Fase 4 en staging,
 * sin tocar datos reales. Crea: 1 vendedor VENDEDOR de prueba, 1 vendedor
 * ADMIN de prueba, 1 demo asignada al vendedor de prueba. Imprime
 * credenciales e ids en JSON para que el script de prueba end-to-end los use.
 *
 * Uso: node scripts/_fixture-prueba-fase4.js
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  const passwordPlano = 'PruebaFase4-2026!';
  const passwordHash = await bcrypt.hash(passwordPlano, 10);

  const rubro = await prisma.rubroTemplate.findFirst({ where: { clave: 'optica' } });

  const vendedorTest = await prisma.vendedor.upsert({
    where: { email: 'prueba-fase4-vendedor@multidigital.cl' },
    update: { passwordHash, activo: true, rol: 'VENDEDOR' },
    create: {
      nombre: '[PRUEBA] Vendedor Fase4',
      email: 'prueba-fase4-vendedor@multidigital.cl',
      passwordHash,
      rol: 'VENDEDOR',
    },
  });

  const adminTest = await prisma.vendedor.upsert({
    where: { email: 'prueba-fase4-admin@multidigital.cl' },
    update: { passwordHash, activo: true, rol: 'ADMIN' },
    create: {
      nombre: '[PRUEBA] Admin Fase4',
      email: 'prueba-fase4-admin@multidigital.cl',
      passwordHash,
      rol: 'ADMIN',
    },
  });

  const empresaDemo = await prisma.empresa.create({
    data: {
      nombre: '[PRUEBA] Óptica Fase4',
      rubroTemplateId: rubro.id,
      esDemo: true,
    },
  });

  const telefonoPrueba = `569${Date.now().toString().slice(-8)}`;
  const demo = await prisma.demoAsignada.create({
    data: {
      telefono: telefonoPrueba,
      empresaDemoId: empresaDemo.id,
      nombreProspecto: '[PRUEBA] Prospecto Fase4',
      vendedorId: vendedorTest.id,
      origenDemo: 'vendedor',
    },
  });

  console.log(JSON.stringify({
    passwordPlano,
    vendedorTestId: vendedorTest.id,
    vendedorTestEmail: vendedorTest.email,
    adminTestId: adminTest.id,
    adminTestEmail: adminTest.email,
    empresaDemoId: empresaDemo.id,
    demoId: demo.id,
    telefonoPrueba,
  }, null, 2));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
