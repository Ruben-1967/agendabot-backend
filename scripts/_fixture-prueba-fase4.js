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

  // Números fijos, dados explícitamente por Ruben para poder recibir el
  // WhatsApp real de "Convertir a cliente real" en su propio celular — nunca
  // generados acá (ver memoria feedback_telefonos_prueba_fijos.md: convertir
  // a cliente real envía un WhatsApp REAL, sin mock en ningún ambiente).
  const casos = [
    { sufijo: 'Caso 1', telefono: '56984084321' },
    { sufijo: 'Caso 2', telefono: '56966108858' },
  ];

  const resultados = [];
  for (const caso of casos) {
    const empresaDemo = await prisma.empresa.create({
      data: {
        nombre: `[PRUEBA] Óptica Fase4 - ${caso.sufijo}`,
        rubroTemplateId: rubro.id,
        esDemo: true,
      },
    });

    const demo = await prisma.demoAsignada.create({
      data: {
        telefono: caso.telefono,
        empresaDemoId: empresaDemo.id,
        nombreProspecto: `[PRUEBA] Prospecto Fase4 - ${caso.sufijo}`,
        vendedorId: vendedorTest.id,
        origenDemo: 'vendedor',
      },
    });

    resultados.push({ sufijo: caso.sufijo, empresaDemoId: empresaDemo.id, demoId: demo.id, telefono: caso.telefono });
  }

  console.log(JSON.stringify({
    passwordPlano,
    vendedorTestId: vendedorTest.id,
    vendedorTestEmail: vendedorTest.email,
    adminTestId: adminTest.id,
    adminTestEmail: adminTest.email,
    casos: resultados,
  }, null, 2));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
