#!/usr/bin/env node
// Uso puntual: para los Cliente con telefono mal formado (con "+", espacios,
// o "null" literal) Y una Cita PENDIENTE futura (detectados por
// _detectar-clientes-telefono-mal-formado-riesgo-real.js), corrige el
// FORMATO del telefono a dígitos puros -- NO es una fusión de 2 personas
// distintas, es corregir el formato del mismo registro para que vuelva a
// calzar con lo que WhatsApp manda de verdad.
//
// Seguridad: si el número normalizado YA le pertenece a OTRO Cliente
// distinto de esta misma empresa (señal de que ya existe el Cliente
// huérfano gemelo, ej. caso real de Diego), NO se toca -- ese caso
// necesita revisión manual (fusión de 2 registros), se imprime aparte.
//
// DRY-RUN por defecto. Para aplicar de verdad:
//   APLICAR=1 node scripts/_normalizar-telefono-clientes-riesgo-real.js
//
// USO (Shell de Render, producción):
//   node scripts/_normalizar-telefono-clientes-riesgo-real.js          (dry-run)
//   APLICAR=1 node scripts/_normalizar-telefono-clientes-riesgo-real.js (aplica)

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
  console.log(APLICAR ? '⚡ MODO APLICAR -- esto va a escribir en la base.' : '🔍 DRY-RUN -- no se escribe nada (correr con APLICAR=1 para aplicar).');

  const empresasConRut = await prisma.empresa.findMany({
    where: { requiereRut: true },
    select: { id: true, nombre: true },
  });

  const ahora = new Date();
  let corregidos = 0;
  let necesitanRevisionManual = 0;

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        citas: { some: { estado: 'PENDIENTE', fechaHoraInicio: { gt: ahora } } },
      },
    });

    const malFormados = candidatos.filter((c) => !pareceFormatoMetaValido(c.telefono));
    if (malFormados.length === 0) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Empresa: ${empresa.nombre} -- ${malFormados.length} candidato(s) con cita futura pendiente\n`);

    for (const c of malFormados) {
      const normalizado = normalizar(c.telefono);
      if (!normalizado) {
        console.log(`  ⏭️  id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}" -- no se pudo normalizar (vacío), se salta.`);
        continue;
      }

      const colision = await prisma.cliente.findFirst({
        where: { empresaId: empresa.id, telefono: normalizado, NOT: { id: c.id } },
      });

      if (colision) {
        necesitanRevisionManual++;
        console.log(`  ⚠️  REVISIÓN MANUAL: id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}" -> ya existe OTRO Cliente (id=${colision.id}, nombre="${colision.nombre}") con telefono="${normalizado}". NO se toca -- son probablemente la misma persona, hay que fusionar a mano.`);
        continue;
      }

      corregidos++;
      console.log(`  ${APLICAR ? '✅ CORREGIDO' : '➡️  se corregiría'}: id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}" -> "${normalizado}"`);
      if (APLICAR) {
        await prisma.cliente.update({ where: { id: c.id }, data: { telefono: normalizado } });
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${APLICAR ? 'Corregidos' : 'Se corregirían'}: ${corregidos}`);
  console.log(`Necesitan revisión manual (posible fusión de 2 personas): ${necesitanRevisionManual}`);
  if (!APLICAR && corregidos > 0) {
    console.log('\nPara aplicar de verdad: APLICAR=1 node scripts/_normalizar-telefono-clientes-riesgo-real.js');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
