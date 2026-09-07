#!/usr/bin/env node
/**
 * La importación de pacientes de LuxVision (ver
 * scripts/importar-clientes-luxvision.js) solo creó filas Cliente, nunca
 * ninguna AtencionClinica -- por eso el panel no mostraba "Fecha de esta
 * atención" en el historial de ningún paciente importado. Este script crea
 * UNA AtencionClinica histórica por paciente, usando la fecha real de su
 * última visita (que ya estaba guardada, solo oculta, en
 * Cliente.fichaJson.fechaVisitaImportada).
 *
 * IMPORTANTE: a propósito NO toca Cliente.fichaJson ni llama al recálculo
 * de caché que hace la ruta normal de crear atención (recalcularCacheCliente
 * en routes/clientes.js) -- eso pisaría fechaVisitaImportada con el fichaJson
 * de la nueva atención y activaría el recordatorio antes del 21 de
 * septiembre (ver scripts/activar-recordatorios-luxvision.js). Esta corrida
 * solo agrega la fila de historial, nada más.
 *
 * No se fija fechaProximaCitaFijada -- no hay ninguna cita realmente
 * agendada para estos pacientes, así que "Fecha de la próxima visita" sigue
 * en blanco hasta que se agende algo de verdad (correcto).
 *
 * Idempotente: salta cualquier cliente que ya tenga alguna AtencionClinica.
 *
 * Uso:
 *   EMPRESA_ID=<id> node scripts/backfill-atenciones-luxvision.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const empresaId = process.env.EMPRESA_ID;

if (!empresaId) {
  console.error('Uso: EMPRESA_ID=<id> node scripts/backfill-atenciones-luxvision.js');
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
    select: {
      id: true,
      fichaJson: true,
      _count: { select: { atencionesClinicas: true } },
    },
  });

  let creadas = 0, saltadosSinFecha = 0, saltadosYaTenianHistorial = 0, errores = 0;

  for (const cliente of clientes) {
    if (cliente._count.atencionesClinicas > 0) {
      saltadosYaTenianHistorial++;
      continue;
    }
    const fechaVisita = cliente.fichaJson?.fechaVisitaImportada || cliente.fichaJson?.receta?.fecha;
    if (!fechaVisita) {
      saltadosSinFecha++;
      continue;
    }

    try {
      await prisma.atencionClinica.create({
        data: {
          clienteId: cliente.id,
          fecha: new Date(fechaVisita),
          fichaJson: {
            receta: { fecha: fechaVisita },
            ...(cliente.fichaJson?.numeroOrdenTrabajo && { numeroOrdenTrabajo: cliente.fichaJson.numeroOrdenTrabajo }),
            notaImportacion: 'Registro histórico creado al importar la base de pacientes (2026-09-06), sin datos de receta detallados.',
          },
        },
      });
      creadas++;
    } catch (err) {
      errores++;
      console.error(`Error creando atención para cliente ${cliente.id}:`, err.message);
    }
  }

  console.log(`\nResultado: creadas=${creadas} saltados_sin_fecha=${saltadosSinFecha} saltados_ya_tenian_historial=${saltadosYaTenianHistorial} errores=${errores}`);
}

main()
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
