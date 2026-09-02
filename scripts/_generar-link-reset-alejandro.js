#!/usr/bin/env node
/**
 * Genera un link de reset de contraseña para la cuenta de Alejandro Barber
 * (mismo mecanismo que POST /auth/solicitar-reset-password, pero sin
 * disparar el envío automático por WhatsApp — el email registrado es
 * ficticio, así que el link se entrega acá para compartirlo manualmente).
 *
 * Escribe en la base (regenera tokenActivacion/tokenActivacionExpira de ese
 * Usuario puntual) — no toca ningún otro dato.
 *
 * Uso (Shell de Render, producción): node scripts/_generar-link-reset-alejandro.js
 */
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { obtenerUrlPanelPrincipal } = require('../src/lib/urlPanel');

const EMAIL = 'alejandro@vargas.cl';

async function main() {
  const usuario = await prisma.usuario.findFirst({ where: { email: { equals: EMAIL.trim(), mode: 'insensitive' } } });
  if (!usuario) {
    console.log(`No se encontró ningún Usuario con email ${EMAIL}.`);
    await prisma.$disconnect();
    return;
  }

  const tokenActivacion = crypto.randomBytes(24).toString('hex');
  const tokenActivacionExpira = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { tokenActivacion, tokenActivacionExpira },
  });

  const link = `${obtenerUrlPanelPrincipal()}/activar-cuenta?token=${tokenActivacion}&tipo=reset`;
  console.log(`\nLink de reset para ${usuario.nombre} (${usuario.email}), válido por 2 horas:\n${link}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
