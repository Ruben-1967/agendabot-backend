#!/usr/bin/env node
/**
 * Activa el recordatorio de control anual para los clientes de LuxVision
 * importados el 2026-09-06 con la fecha oculta a propósito (ver
 * scripts/importar-clientes-luxvision.js) -- mueve
 * fichaJson.fechaVisitaImportada a fichaJson.receta.fecha, que es lo único
 * que enviarRecordatorios.js revisa para decidir a quién avisar.
 *
 * Pensado para correr el 21 de septiembre de 2026 o después (pedido
 * explícito del negocio). Es seguro correrlo más de una vez: solo toca
 * clientes que todavía tengan fechaVisitaImportada pendiente.
 *
 * Uso:
 *   EMPRESA_ID=<id> node scripts/activar-recordatorios-luxvision.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const empresaId = process.env.EMPRESA_ID;

if (!empresaId) {
  console.error('Uso: EMPRESA_ID=<id> node scripts/activar-recordatorios-luxvision.js');
  process.exit(1);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  console.log('Empresa encontrada:', empresa.nombre);

  const clientes = await prisma.cliente.findMany({
    where: { empresaId },
    select: { id: true, fichaJson: true },
  });

  const pendientes = clientes.filter((c) => c.fichaJson?.fechaVisitaImportada);
  console.log(`Clientes con recordatorio pendiente de activar: ${pendientes.length} de ${clientes.length} totales.`);

  let activados = 0, errores = 0;

  for (const cliente of pendientes) {
    const { fechaVisitaImportada, ...resto } = cliente.fichaJson;
    try {
      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { fichaJson: { ...resto, receta: { fecha: fechaVisitaImportada } } },
      });
      activados++;
    } catch (err) {
      errores++;
      console.error(`Error activando cliente ${cliente.id}:`, err.message);
    }
  }

  console.log(`\nResultado: activados=${activados} errores=${errores}`);
}

main()
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
