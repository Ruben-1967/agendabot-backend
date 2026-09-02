#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: ¿hay más de una Empresa "Alejandro Barber"?
 * El bot ya responde en +56949528788 pero con servicios que no calzan con
 * lo configurado en el panel — hipótesis: el admin está mirando una
 * empresa distinta a la que quedó con el WhatsApp conectado.
 *
 * Uso (Render Shell): node scripts/_buscar-duplicados-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Barber', mode: 'insensitive' } },
    include: {
      servicios: { select: { nombre: true, activo: true } },
      usuarios: { select: { email: true, rol: true } },
    },
  });

  console.log(`Encontradas ${empresas.length} empresa(s) con "Barber" en el nombre:\n`);
  empresas.forEach((e) => {
    console.log(`- ${e.nombre} | id=${e.id} | creadaEn=${e.creadoEn?.toISOString()}`);
    console.log(`  WhatsApp: ${e.whatsappPhoneNumber || '(sin conectar)'} | numeroId=${e.whatsappNumeroId || '—'}`);
    console.log(`  Usuarios del panel: ${e.usuarios.map((u) => `${u.email} (${u.rol})`).join(', ') || '(ninguno)'}`);
    console.log(`  Servicios (${e.servicios.length}): ${e.servicios.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(', ') || '(ninguno)'}`);
    console.log('');
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
