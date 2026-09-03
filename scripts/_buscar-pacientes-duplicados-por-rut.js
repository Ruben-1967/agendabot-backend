#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: busca Cliente duplicados por RUT (mismo
 * paciente, 2+ filas) dentro de cada empresa real — remanente del bug de
 * RUT cifrado sin descifrar en relaciones anidadas (corregido 2026-09-01),
 * que rompía la detección de duplicados en el flujo del bot mientras
 * estuvo activo. Como el RUT está cifrado (AES-256-GCM, no determinístico
 * — el mismo RUT da un texto cifrado distinto cada vez), no se puede
 * comparar por SQL directo: hay que descifrar cada fila en memoria y
 * agrupar acá.
 *
 * Solo mira empresas reales (no demo, con WhatsApp conectado) — no toca
 * nada, solo reporta.
 *
 * Uso (Render Shell): node scripts/_buscar-pacientes-duplicados-por-rut.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { esDemo: false, whatsappNumeroId: { not: null } },
    select: { id: true, nombre: true },
  });

  let totalGruposDuplicados = 0;

  for (const empresa of empresas) {
    const clientes = await prisma.cliente.findMany({
      where: { empresaId: empresa.id, rut: { not: null } },
      select: {
        id: true, nombre: true, telefono: true, rut: true, creadoEn: true,
        _count: { select: { citas: true, ventas: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });

    const porRutDescifrado = new Map();
    for (const c of clientes) {
      const rutPlano = descifrarSiCorresponde(c.rut);
      if (!rutPlano) continue;
      if (!porRutDescifrado.has(rutPlano)) porRutDescifrado.set(rutPlano, []);
      porRutDescifrado.get(rutPlano).push({ ...c, rutPlano });
    }

    const grupos = [...porRutDescifrado.entries()].filter(([, filas]) => filas.length > 1);
    if (grupos.length === 0) continue;

    console.log(`\n=== ${empresa.nombre} — ${grupos.length} RUT con duplicados ===`);
    for (const [rut, filas] of grupos) {
      totalGruposDuplicados++;
      console.log(`\nRUT ${rut}:`);
      filas.forEach((f) =>
        console.log(`  id=${f.id} | ${f.nombre} | ${f.telefono} | citas=${f._count.citas} | ventas=${f._count.ventas} | creado=${f.creadoEn.toISOString()}`)
      );
    }
  }

  if (totalGruposDuplicados === 0) {
    console.log('\nNo se encontró ningún paciente duplicado por RUT en ninguna empresa real.');
  } else {
    console.log(`\n\nTotal: ${totalGruposDuplicados} paciente(s) con filas duplicadas.`);
  }
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
