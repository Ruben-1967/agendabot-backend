#!/usr/bin/env node
// Uso puntual (solo lectura): refina la lista de
// _detectar-clientes-huerfanos-telefono-duplicado.js -- de esos 95+
// "sospechosos" en Ahorróptica, la mayoría probablemente son clientes que
// el personal agendó directo desde el panel (nunca escribieron por
// WhatsApp) -- eso NO es el bug, es un falso positivo esperado.
//
// La señal confiable de que SÍ es el bug real: el telefono guardado no
// tiene la forma que Meta manda de verdad (dígitos puros, sin "+", sin
// espacios) -- ESE Cliente nunca va a volver a calzar si el cliente real
// escribe por WhatsApp. Separa además cuáles de esos tienen una Cita
// PENDIENTE con fecha futura todavía por confirmar -- ese es el riesgo
// real y urgente, no los casos ya pasados. No repara nada.
//
// USO (Shell de Render, producción):
//   node scripts/_detectar-clientes-telefono-mal-formado-riesgo-real.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

function pareceFormatoMetaValido(telefono) {
  // Lo que Meta manda de verdad: solo dígitos, típicamente 11-12 (código
  // país + número), sin "+", sin espacios, sin guiones.
  return /^\d{8,15}$/.test(telefono || '');
}

async function main() {
  const empresasConRut = await prisma.empresa.findMany({
    where: { requiereRut: true },
    select: { id: true, nombre: true },
  });

  const ahora = new Date();
  let totalMalFormados = 0;
  let totalConCitaFuturaPendiente = 0;

  for (const empresa of empresasConRut) {
    const candidatos = await prisma.cliente.findMany({
      where: {
        empresaId: empresa.id,
        conversaciones: { none: {} },
        citas: { some: {} },
      },
      include: {
        citas: { where: { estado: 'PENDIENTE' }, orderBy: { fechaHoraInicio: 'asc' } },
      },
    });

    const malFormados = candidatos.filter((c) => !pareceFormatoMetaValido(c.telefono));
    if (malFormados.length === 0) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Empresa: ${empresa.nombre}`);
    console.log(`Cliente con telefono mal formado (riesgo real confirmado): ${malFormados.length} de ${candidatos.length} sospechosos totales`);

    for (const c of malFormados) {
      totalMalFormados++;
      const citasFuturasPendientes = c.citas.filter((cita) => cita.fechaHoraInicio > ahora);
      if (citasFuturasPendientes.length > 0) {
        totalConCitaFuturaPendiente++;
        console.log(`  ⚠️  URGENTE: id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}"`);
        for (const cita of citasFuturasPendientes) {
          console.log(`      Cita PENDIENTE futura: ${cita.fechaHoraInicio.toISOString()} (confirmacionIntentos=${cita.confirmacionIntentos}) -- si el cliente responde "Sí"/"No", NO va a confirmar (mismo bug de Diego).`);
        }
      } else {
        console.log(`  - id=${c.id} nombre="${c.nombre}" telefono="${c.telefono}" (sin citas futuras pendientes -- ya no hay riesgo práctico)`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total Cliente con telefono realmente mal formado: ${totalMalFormados}`);
  console.log(`De esos, con una Cita futura PENDIENTE (riesgo real, urgente): ${totalConCitaFuturaPendiente}`);
  console.log('\nEsto NO repara nada. Para los urgentes, la opción más simple es contactar');
  console.log('al cliente por otra vía (o que el negocio confirme manualmente en el panel)');
  console.log('para esa cita puntual -- fusionar el Cliente es aparte y siempre manual.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
