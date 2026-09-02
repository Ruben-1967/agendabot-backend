#!/usr/bin/env node
/**
 * Verifica el fix de descifrarSiCorresponde para Empresa.whatsappToken
 * anidado (bug real: enviarPreguntaOptIn.js, recordatoriosFicha.js,
 * confirmarCitasProximas.js y pausaCoexistence.js mandaban el token
 * CIFRADO tal cual a Meta, que lo rechazaba con "Authentication Error").
 *
 * Requiere ENCRYPTION_KEY real — correr en Render Shell (staging o prod).
 * Crea su propia Empresa/Cliente de prueba y los borra al final.
 *
 * Uso: node scripts/_probar-fix-token-cifrado.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde, esValorCifrado } = require('../src/lib/cifrado');

const NOMBRE_EMPRESA_PRUEBA = 'PRUEBA CLAUDE - Fix Token Cifrado';
const TOKEN_FALSO = 'EAA-token-de-prueba-1234567890';

async function main() {
  const previa = await prisma.empresa.findFirst({ where: { nombre: NOMBRE_EMPRESA_PRUEBA } });
  if (previa) {
    await prisma.cliente.deleteMany({ where: { empresaId: previa.id } });
    await prisma.empresa.delete({ where: { id: previa.id } });
  }

  const rubro = await prisma.rubroTemplate.findFirst();
  const empresa = await prisma.empresa.create({
    data: { nombre: NOMBRE_EMPRESA_PRUEBA, rubroTemplateId: rubro.id, whatsappToken: TOKEN_FALSO },
  });
  const cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre: 'PRUEBA CLAUDE' } });

  let ok = true;

  // 1. Confirma que el bug existía: consulta anidada (mismo patrón que los
  //    4 archivos rotos) devuelve el token CIFRADO tal cual, no el real.
  const clienteConEmpresa = await prisma.cliente.findFirst({
    where: { id: cliente.id },
    include: { empresa: true },
  });
  const tokenCrudo = clienteConEmpresa.empresa.whatsappToken;
  console.log('Token tal como llega anidado (sin el fix):', tokenCrudo);
  if (!esValorCifrado(tokenCrudo)) {
    ok = false;
    console.error('  <<< INESPERADO: se esperaba que llegara cifrado (enc:v1:...) — revisar si algo cambió en la extensión de Prisma.');
  } else {
    console.log('  Confirmado: llega cifrado, tal como se reportó en el bug real.');
  }

  // 2. Con el fix (descifrarSiCorresponde), debe recuperar el token real.
  const tokenDescifrado = descifrarSiCorresponde(tokenCrudo);
  console.log('\nToken tras descifrarSiCorresponde():', tokenDescifrado);
  if (tokenDescifrado !== TOKEN_FALSO) {
    ok = false;
    console.error(`  <<< FALLO: se esperaba "${TOKEN_FALSO}"`);
  } else {
    console.log('  OK: coincide exacto con el token original.');
  }

  // 3. Una consulta DIRECTA a Empresa (no anidada) debe seguir llegando ya
  //    descifrada automáticamente, sin necesitar el helper — para confirmar
  //    que el fix no rompe el camino que ya funcionaba bien.
  const empresaDirecta = await prisma.empresa.findUnique({ where: { id: empresa.id } });
  console.log('\nToken vía consulta DIRECTA a Empresa (ya debería venir descifrado solo):', empresaDirecta.whatsappToken);
  if (empresaDirecta.whatsappToken !== TOKEN_FALSO) {
    ok = false;
    console.error(`  <<< FALLO: se esperaba "${TOKEN_FALSO}" ya descifrado automáticamente por la extensión de Prisma`);
  } else {
    console.log('  OK.');
  }

  await prisma.cliente.delete({ where: { id: cliente.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log('\nLimpieza completa.');

  console.log(ok ? '\n✅ TODO OK' : '\n❌ HUBO FALLOS');
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
