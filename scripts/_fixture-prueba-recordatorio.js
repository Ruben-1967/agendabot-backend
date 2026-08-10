/**
 * Fixture descartable para probar POST/PATCH /clientes/:id/atenciones
 * (cálculo de recordatorioModo). No usa ningún número de teléfono real.
 *
 * Uso: node scripts/_fixture-prueba-recordatorio.js
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  const rubro = await prisma.rubroTemplate.findFirst({ where: { clave: 'salud_privada' } });
  const passwordPlano = 'PruebaRecordatorio-2026!';
  const passwordHash = await bcrypt.hash(passwordPlano, 10);

  const empresa = await prisma.empresa.create({
    data: { nombre: '[PRUEBA] Clinica Recordatorio', rubroTemplateId: rubro.id, esDemo: false },
  });

  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      nombre: '[PRUEBA] Admin Recordatorio',
      email: 'prueba-recordatorio@multidigital.cl',
      passwordHash,
      rol: 'ADMIN',
    },
  });

  const cliente = await prisma.cliente.create({
    data: { empresaId: empresa.id, nombre: '[PRUEBA] Paciente Recordatorio' },
  });

  console.log(JSON.stringify({ empresaId: empresa.id, usuarioEmail: usuario.email, passwordPlano, clienteId: cliente.id }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
