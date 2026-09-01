#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA: busca la cuenta de "Alejandro Barber"
 * (email alejandro@vargas.cl / fono 933353668) cuyo link de activación
 * habría expirado, para confirmar identidad antes de regenerar el token.
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_buscar-cuenta-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const usuarios = await prisma.usuario.findMany({
    where: {
      OR: [
        { email: { contains: 'vargas.cl', mode: 'insensitive' } },
        { nombre: { contains: 'Barber', mode: 'insensitive' } },
        { nombre: { contains: 'Alejandro', mode: 'insensitive' } },
        { empresa: { nombre: { contains: 'Barber', mode: 'insensitive' } } },
        { empresa: { telefonoContacto: { contains: '933353668' } } },
      ],
    },
    include: { empresa: true },
  });

  if (usuarios.length === 0) {
    console.log('No se encontró ningún Usuario/Empresa que calce con esos datos.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Encontrados ${usuarios.length} resultado(s):\n`);
  usuarios.forEach((u) => {
    console.log(`Usuario id=${u.id} nombre="${u.nombre}" email=${u.email} rol=${u.rol}`);
    console.log(`  tokenActivacion=${u.tokenActivacion ? '(presente)' : 'null (cuenta ya activada)'}`);
    console.log(`  tokenActivacionExpira=${u.tokenActivacionExpira ? u.tokenActivacionExpira.toISOString() : 'null'} | ¿expirado? ${u.tokenActivacionExpira ? (u.tokenActivacionExpira < new Date() ? 'SÍ' : 'no') : '-'}`);
    console.log(`  fechaActivacionCuenta=${u.fechaActivacionCuenta ? u.fechaActivacionCuenta.toISOString() : 'nunca activada'}`);
    console.log(`  Empresa: id=${u.empresa.id} nombre="${u.empresa.nombre}" telefonoContacto=${u.empresa.telefonoContacto} emailContacto=${u.empresa.emailContacto}`);
    console.log('');
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
