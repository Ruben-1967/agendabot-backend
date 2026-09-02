#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: el job de preguntas de opt-in
 * (src/jobs/enviarPreguntaOptIn.js) está fallando con "Authentication
 * Error" (código 190) para varios clientes. Agrupa los candidatos por
 * empresa para saber si es un token por-empresa vencido, o el token de
 * respaldo genérico (WHATSAPP_ACCESS_TOKEN) el que falló.
 *
 * No modifica nada. Uso (Shell de Render, producción):
 *   node scripts/_diagnosticar-error-optin.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const clientesCandidatos = await prisma.cliente.findMany({
    where: {
      optInCampanasPreguntado: false,
      telefono: { not: null },
      empresa: { esDemo: false, whatsappNumeroId: { not: null } },
    },
    include: { empresa: { select: { id: true, nombre: true, whatsappToken: true, whatsappNumeroId: true } } },
  });

  console.log(`Total de clientes candidatos al job de opt-in: ${clientesCandidatos.length}\n`);

  const porEmpresa = new Map();
  for (const c of clientesCandidatos) {
    const key = c.empresa.id;
    if (!porEmpresa.has(key)) {
      porEmpresa.set(key, { nombre: c.empresa.nombre, tieneTokenPropio: !!c.empresa.whatsappToken, numeroId: c.empresa.whatsappNumeroId, cantidad: 0 });
    }
    porEmpresa.get(key).cantidad++;
  }

  console.log('Empresas afectadas (candidatas al job):');
  for (const [id, info] of porEmpresa) {
    console.log(`- ${info.nombre} (${id}) | clientes candidatos=${info.cantidad} | tiene whatsappToken propio=${info.tieneTokenPropio} | numeroId=${info.numeroId}`);
  }

  console.log(`\nWHATSAPP_ACCESS_TOKEN (respaldo genérico) presente: ${process.env.WHATSAPP_ACCESS_TOKEN ? 'sí' : 'no'}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
