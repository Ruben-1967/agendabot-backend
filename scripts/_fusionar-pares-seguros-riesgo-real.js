#!/usr/bin/env node
// Uso puntual: aplica a TODOS los pares "seguros" (detectados por
// _revisar-pares-fusion-manual-riesgo-real.js) el mismo arreglo ya
// validado a mano con Diego -- corrige el teléfono del Cliente real,
// reapunta su(s) Conversacion, y borra el Cliente huérfano. Un par se
// considera "seguro" SOLO si el huérfano tiene CERO relaciones reales
// propias (citas/ventas/listaEspera/pedidos/atencionesClinicas) --
// vuelve a verificarlo en el momento de escribir, no confía en una
// lectura previa. Si algo no calza, salta ese par sin tocarlo.
//
// DRY-RUN por defecto. Para aplicar de verdad:
//   APLICAR=1 node scripts/_fusionar-pares-seguros-riesgo-real.js
//
// USO (Shell de Render, producción):
//   node scripts/_fusionar-pares-seguros-riesgo-real.js           (dry-run)
//   APLICAR=1 node scripts/_fusionar-pares-seguros-riesgo-real.js  (aplica)

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const APLICAR = process.env.APLICAR === '1';

function pareceFormatoMetaValido(telefono) {
  return /^\d{8,15}$/.test(telefono || '');
}
function normalizar(telefono) {
  return (telefono || '').replace(/[^\d]/g, '');
}

async function main() {
  console.log(APLICAR ? '⚡ MODO APLICAR -- esto va a escribir en la base.' : '🔍 DRY-RUN -- no se escribe nada.');

  const empresasConRut = await prisma.empresa.findMany({ where: { requiereRut: true }, select: { id: true, nombre: true } });
  const ahora = new Date();

  let fusionados = 0;
  let saltados = 0;

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        citas: { some: { estado: 'PENDIENTE', fechaHoraInicio: { gt: ahora } } },
      },
    });
    const malFormados = candidatos.filter((c) => !pareceFormatoMetaValido(c.telefono));

    for (const clienteReal of malFormados) {
      const normalizado = normalizar(clienteReal.telefono);
      if (!normalizado) continue;

      const huerfano = await prisma.cliente.findFirst({
        where: { empresaId: empresa.id, telefono: normalizado, NOT: { id: clienteReal.id } },
        include: { _count: { select: { citas: true, ventas: true, listaEspera: true, pedidos: true, atencionesClinicas: true } } },
      });
      if (!huerfano) continue; // no hay colisión -- ese caso ya lo resuelve _normalizar-telefono-clientes-riesgo-real.js

      const totalRelacionesHuerfano = Object.values(huerfano._count).reduce((a, b) => a + b, 0);
      if (totalRelacionesHuerfano > 0) {
        saltados++;
        console.log(`⚠️  SALTADO: "${clienteReal.nombre}" <-> "${huerfano.nombre}" -- el huérfano tiene ${totalRelacionesHuerfano} relación(es) real(es), no se puede asumir que es la misma persona.`);
        continue;
      }

      fusionados++;
      console.log(`${APLICAR ? '✅ FUSIONADO' : '➡️  se fusionaría'}: "${clienteReal.nombre}" (${clienteReal.id}) <- "${huerfano.nombre}" (${huerfano.id}), telefono -> "${normalizado}"`);

      if (APLICAR) {
        await prisma.$transaction(async (tx) => {
          // Re-verificar DENTRO de la transacción, justo antes de borrar --
          // la lectura de arriba (huerfano._count) es de antes de este loop,
          // pudo quedar vieja si algo le creó una relación real en el medio.
          const huerfanoFresco = await tx.cliente.findUnique({
            where: { id: huerfano.id },
            include: { _count: { select: { citas: true, ventas: true, listaEspera: true, pedidos: true, atencionesClinicas: true } } },
          });
          if (!huerfanoFresco) return; // ya no existe (fusionado por otra corrida), nada que hacer
          const totalFresco = Object.values(huerfanoFresco._count).reduce((a, b) => a + b, 0);
          if (totalFresco > 0) {
            throw new Error(`Abortado en el último momento -- "${huerfano.nombre}" ganó una relación real justo antes de fusionar.`);
          }
          await tx.cliente.update({ where: { id: clienteReal.id }, data: { telefono: normalizado } });
          await tx.conversacion.updateMany({ where: { clienteId: huerfano.id }, data: { clienteId: clienteReal.id } });
          await tx.cliente.delete({ where: { id: huerfano.id } });
        });
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${APLICAR ? 'Fusionados' : 'Se fusionarían'}: ${fusionados}`);
  console.log(`Saltados (relación real en el huérfano, no seguro): ${saltados}`);
  if (!APLICAR && fusionados > 0) {
    console.log('\nPara aplicar de verdad: APLICAR=1 node scripts/_fusionar-pares-seguros-riesgo-real.js');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
