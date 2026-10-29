#!/usr/bin/env node
/**
 * 2026-10-29: Ahorróptica pidió que el sistema recuerde UNA sola vez cada cita (el ciclo de 3 avisos
 * molestaba a los pacientes). Pone Empresa.confirmacionMaxIntentos = 1 SOLO en Ahorróptica.
 * Con 1 aviso no hay "último aviso" ni cancelación automática: la cita sigue PENDIENTE hasta gestión
 * manual. No manda mensajes. Requiere correr antes scripts/_migracion-confirmacion-max-intentos-29oct.sql.
 *
 * Uso (Shell de Render): node scripts/_aplicar-recordatorio-unico-ahoroptica-29oct.js   (dry-run)
 *                        APLICAR=1 node scripts/_aplicar-recordatorio-unico-ahoroptica-29oct.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const NUEVO_VALOR = 1;

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, confirmacionMaxIntentos: true } });
  if (!empresa || !/ahor/i.test(empresa.nombre)) throw new Error('No es la Empresa Ahorróptica -- no se hace nada.');
  console.log(`${empresa.nombre}: confirmacionMaxIntentos actual = ${empresa.confirmacionMaxIntentos} -> nuevo = ${NUEVO_VALOR}`);
  if (process.env.APLICAR !== '1') return console.log('Dry-run: no se cambió nada. Corre con APLICAR=1 para aplicar.');
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { confirmacionMaxIntentos: NUEVO_VALOR } });
  console.log('✅ Aplicado.');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
