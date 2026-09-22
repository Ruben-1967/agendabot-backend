#!/usr/bin/env node
// Uso puntual de emergencia: genera un link de reset de contraseña válido
// (mismo mecanismo que POST /auth/solicitar-reset-password) y lo IMPRIME
// directo en la terminal, sin depender del envío por WhatsApp -- útil
// cuando ese envío falla (ver diagnóstico 2026-09-22: error 131047,
// "Re-engagement message", ventana de 24h cerrada).
//
// Corre este script TÚ MISMO en el Shell de Render y copia el link
// directo desde tu propia terminal -- no se lo pases a nadie más ni lo
// pegues en otro chat, es equivalente a una contraseña temporal.
//
// USO (Shell de Render, producción):
//   EMAIL="contacto@luxvision.cl" node scripts/_generar-link-reset-manual.js

require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { obtenerUrlPanelPrincipal } = require('../src/lib/urlPanel');

async function main() {
  const email = process.env.EMAIL;
  if (!email) {
    throw new Error('Falta EMAIL -- correr como: EMAIL="contacto@luxvision.cl" node scripts/_generar-link-reset-manual.js');
  }

  const usuario = await prisma.usuario.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
    include: { empresa: true },
  });

  if (!usuario) {
    console.log(`No se encontró ningún Usuario con email "${email}".`);
    return;
  }

  const tokenActivacion = crypto.randomBytes(24).toString('hex');
  const tokenActivacionExpira = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas, igual que el flujo normal

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { tokenActivacion, tokenActivacionExpira },
  });

  const linkReset = `${obtenerUrlPanelPrincipal()}/activar-cuenta?token=${tokenActivacion}&tipo=reset`;

  console.log(`\nUsuario: ${usuario.nombre} (${usuario.email}) — Empresa: ${usuario.empresa.nombre}`);
  console.log(`Link válido por 2 horas (hasta ${tokenActivacionExpira.toISOString()}):\n`);
  console.log(linkReset);
  console.log('\n⚠️  No compartas este link con nadie más -- quien lo abra puede definir la contraseña de esta cuenta.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
