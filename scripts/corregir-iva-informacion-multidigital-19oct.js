#!/usr/bin/env node
/**
 * Corrige en la Empresa "Multidigital" (la del WhatsApp de anuncios) la frase que
 * dice que TotemSystem cuesta "$14.900 al mes IVA incluido": desde 2026-10-16 todos
 * los precios se publican "+ IVA". Solo reemplaza esa frase exacta dentro de
 * informacionAdicional; no toca nada más ni manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/corregir-iva-informacion-multidigital-19oct.js
 *   APLICAR=1 node scripts/corregir-iva-informacion-multidigital-19oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const ANTES = 'desde $14.900 al mes IVA incluido';
const DESPUES = 'desde $14.900 al mes + IVA';

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  const texto = e.informacionAdicional || '';
  const veces = texto.split(ANTES).length - 1;
  console.log(`Frase "${ANTES}": ${veces} ocurrencia(s).`);
  if (veces === 0) {
    console.log(texto.includes(DESPUES) ? 'Ya está corregida.' : 'No se encontró la frase: revisar a mano el campo informacionAdicional.');
    return;
  }
  if (!aplicar) {
    console.log(`DRY-RUN: se reemplazaría por "${DESPUES}". Para aplicar: APLICAR=1`);
    return;
  }
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: texto.split(ANTES).join(DESPUES) } });
  console.log('✅ informacionAdicional de Multidigital actualizado.');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
