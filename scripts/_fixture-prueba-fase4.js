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

  // 'optica' es del seed legacy de Ahorróptica y no existe en todas las bases
  // (ej. agendabot_db_staging usa el set de rubros nuevo) — cae a 'otro' o al
  // primero que haya, para que el fixture sea portable entre bases.
  const rubro =
    (await prisma.rubroTemplate.findFirst({ where: { clave: 'optica' } })) ||
    (await prisma.rubroTemplate.findFirst({ where: { clave: 'otro' } })) ||
    (await prisma.rubroTemplate.findFirst());

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

  // Antes esto generaba un número al azar con forma válida de celular
  // chileno ("569" + timestamp) — riesgo real de coincidir con el número de
  // una persona de verdad, ya que convertir-a-cliente-real envía un WhatsApp
  // REAL (Meta Graph API, sin mock en ningún ambiente) a este número. Se usa
  // en cambio el número de la demo siempre-funcional (el mismo que
  // NuevaDemo.jsx le muestra al vendedor para probar el bot), que es propio
  // del sistema y seguro para recibir mensajes de prueba.
  const telefonoPrueba = '56927679838';
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
