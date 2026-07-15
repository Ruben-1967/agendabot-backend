/**
 * Crea o actualiza un usuario del panel (admin, recepción o profesional).
 *
 * Uso:
 *   node scripts/crear-usuario.js <empresaId> <nombre> <email> <password> <ROL> [recursoAgendableId]
 *
 * Ejemplo — admin de Ahorróptica:
 *   node scripts/crear-usuario.js ahoroptica-lautaro-seed-id "Ruben González" ruben@ahoroptica.cl "unaClaveSegura123" ADMIN
 *
 * Ejemplo — un profesional vinculado a su recurso agendable:
 *   node scripts/crear-usuario.js ahoroptica-lautaro-seed-id "Dra. Camila Reyes" camila@ahoroptica.cl "otraClave456" PROFESIONAL <recursoAgendableId>
 *
 * ROL debe ser uno de: ADMIN, RECEPCION, PROFESIONAL
 */
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  const [empresaId, nombre, email, password, rol, recursoAgendableId] = process.argv.slice(2);

  if (!empresaId || !nombre || !email || !password || !rol) {
    console.error('Faltan argumentos. Uso:');
    console.error('  node scripts/crear-usuario.js <empresaId> <nombre> <email> <password> <ROL> [recursoAgendableId]');
    process.exit(1);
  }

  const rolesValidos = ['ADMIN', 'RECEPCION', 'PROFESIONAL'];
  if (!rolesValidos.includes(rol)) {
    console.error(`ROL inválido: "${rol}". Debe ser uno de: ${rolesValidos.join(', ')}`);
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.error(`No existe ninguna Empresa con id "${empresaId}"`);
    process.exit(1);
  }

  if (rol === 'PROFESIONAL' && recursoAgendableId) {
    const recurso = await prisma.recursoAgendable.findUnique({ where: { id: recursoAgendableId } });
    if (!recurso) {
      console.error(`No existe ningún RecursoAgendable con id "${recursoAgendableId}"`);
      process.exit(1);
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const usuario = await prisma.usuario.upsert({
    where: { email: email.toLowerCase().trim() },
    update: {
      nombre,
      passwordHash,
      rol,
      empresaId: empresa.id,
      recursoAgendableId: recursoAgendableId || null,
    },
    create: {
      empresaId: empresa.id,
      nombre,
      email: email.toLowerCase().trim(),
      passwordHash,
      rol,
      recursoAgendableId: recursoAgendableId || null,
    },
  });

  console.log(`Usuario listo: ${usuario.nombre} <${usuario.email}> — rol ${usuario.rol} en empresa "${empresa.nombre}"`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error creando usuario:', error);
  process.exit(1);
});
