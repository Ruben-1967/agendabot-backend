#!/usr/bin/env node
/**
 * Actualiza en la Empresa "Multidigital" la frase del hosting que lee el bot
 * (informacionAdicional), con el texto definido por Rubén el 2026-10-23:
 *   "Hosting: contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de
 *    descuento (0,5 UF + IVA), a contar del segundo año en adelante 1 UF + IVA al año."
 * Reemplaza solo la oración vieja ("El hosting cuesta 1 UF ... 50% de descuento.");
 * si no la encuentra exactamente una vez, no cambia nada. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/actualizar-hosting-multidigital-23oct.js
 *   APLICAR=1 node scripts/actualizar-hosting-multidigital-23oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const VIEJA = /El hosting cuesta 1 UF[^.]*?50% de descuento\./g;
const NUEVA = 'Hosting: contratando hasta el 31 de octubre de 2026, el primer año tiene 50% de descuento (0,5 UF + IVA), a contar del segundo año en adelante 1 UF + IVA al año. Quien contrate desde el 1 de noviembre de 2026 paga 1 UF + IVA desde el primer año.';

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  const texto = e.informacionAdicional || '';
  if (texto.includes(NUEVA)) { console.log('Ya estaba actualizado: nada que cambiar.'); return; }

  const encontradas = texto.match(VIEJA) || [];
  console.log(`Frase vieja encontrada ${encontradas.length} vez/veces:`);
  encontradas.forEach((f) => console.log(`  "${f}"`));
  if (encontradas.length !== 1) {
    console.log('\nNo se cambia nada (debe aparecer exactamente 1 vez). Frases con "hosting" en el texto actual:');
    (texto.match(/[^.]*hosting[^.]*\./gi) || []).forEach((f) => console.log(`  "${f.trim()}"`));
    process.exitCode = 1;
    return;
  }
  console.log(`\nQuedaría:\n  "${NUEVA}"`);
  if (!aplicar) { console.log('\nDRY-RUN: no se escribió nada. Para aplicar: APLICAR=1'); return; }
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: texto.replace(VIEJA, NUEVA) } });
  console.log('✅ Frase del hosting actualizada en Multidigital.');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
