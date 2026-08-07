/**
 * Crea datos de prueba MÍNIMOS en staging para probar el límite de
 * profesionales por plan (POST /agenda/profesionales).
 *
 * Crea: una Empresa demo simple + un Usuario ADMIN con login real +
 * un RecursoAgendable ya existente (simula "empresa que ya tiene 1
 * profesional"). NO crea Suscripcion a propósito, para probar el caso
 * "sin plan -> límite 1" ya confirmado.
 *
 * Uso (en la Shell de Render de agendabot-backend-staging):
 *   node scripts/crear-prueba-multiprofesional.js
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  try {
  let rubro = await prisma.rubroTemplate.findUnique({ where: { clave: 'otro' } });
    if (!rubro) {
      console.error('No existe RubroTemplate con clave "otro" en esta base. Corre scripts/seed-rubros-nuevos.js primero.');
      process.exit(1);
    }

    const empresa = await prisma.empresa.create({
      data: {
        nombre: 'Demo Test Multiprofesional',
        rubroTemplateId: rubro.id,
        emailContacto: 'test-multiprofe@example.com',
      },
    });

    const passwordHash = await bcrypt.hash('TestMultiprofe123', 10);
    const usuario = await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        nombre: 'Admin Test',
        email: 'admin-test-multiprofe@example.com',
        passwordHash,
        rol: 'ADMIN',
      },
    });

    const recurso = await prisma.recursoAgendable.create({
      data: {
        empresaId: empresa.id,
        tipo: 'profesional',
        nombre: 'Profesional Existente Test',
        duracionCitaMinutos: 30,
      },
    });

    console.log('Datos de prueba creados en staging:');
    console.log('empresaId:', empresa.id);
    console.log('usuario:', usuario.email, '/ password: TestMultiprofe123');
    console.log('recursoAgendable existente:', recurso.id, '-', recurso.nombre);
    console.log('');
    console.log('Sin Suscripcion creada -> limite esperado = 1 -> POST /agenda/profesionales debe dar 402');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();