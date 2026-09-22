#!/usr/bin/env node
// Prueba puntual (Staging): verifica que el nuevo modelo FallaEnvioWhatsApp
// y la lógica de agregación del banner de alerta (GET
// /agenda/dashboard/:empresaId) funcionan como se espera -- inserta 1 fila
// de prueba en una Empresa DEMO existente (nunca una real), replica la
// misma consulta que usa la ruta, y confirma el resultado antes de
// limpiar. No manda WhatsApp, no toca Cliente/Cita/Conversacion.
//
// USO (Shell de Render, Staging):
//   node scripts/_probar-alerta-whatsapp-dashboard.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { traducirErrorWhatsApp } = require('../src/lib/erroresWhatsApp');

async function main() {
  const empresaDemo = await prisma.empresa.findFirst({ where: { esDemo: true } });
  if (!empresaDemo) {
    throw new Error('No se encontró ninguna Empresa DEMO para probar -- abortando (nunca usar una empresa real para esta prueba).');
  }
  console.log(`Usando Empresa DEMO: ${empresaDemo.nombre} (${empresaDemo.id})`);

  let fallaCreada;
  try {
    fallaCreada = await prisma.fallaEnvioWhatsApp.create({
      data: {
        empresaId: empresaDemo.id,
        telefono: '56900000001', // número ficticio, nunca se manda nada real
        wamid: 'wamid.PRUEBA_NO_REAL',
        errorCodigo: 131042,
        errorMensaje: 'Business eligibility payment issue',
      },
    });
    console.log(`✅ Fila de prueba creada: ${fallaCreada.id}`);

    // Misma consulta que routes/agenda.js GET /dashboard/:empresaId
    const desdeSieteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fallas = await prisma.fallaEnvioWhatsApp.findMany({
      where: { empresaId: empresaDemo.id, creadoEn: { gte: desdeSieteDias } },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });

    const alertaWhatsApp = fallas.length > 0
      ? {
          cantidadFallas: fallas.length,
          motivo: traducirErrorWhatsApp(fallas[0].errorCodigo),
          ultimaFallaEn: fallas[0].creadoEn,
        }
      : null;

    console.log('\nResultado (lo que vería el Dashboard):');
    console.log(JSON.stringify(alertaWhatsApp, null, 2));

    if (!alertaWhatsApp || alertaWhatsApp.cantidadFallas !== 1) {
      throw new Error('❌ El resultado no es el esperado (cantidadFallas debería ser 1).');
    }
    if (!alertaWhatsApp.motivo.includes('método de pago')) {
      throw new Error('❌ El mensaje traducido para el código 131042 no calzó con lo esperado.');
    }
    console.log('\n✅ Todo correcto: el banner mostraría la alerta de método de pago.');

    // Confirmar también que SIN fallas recientes, alertaWhatsApp queda null
    await prisma.fallaEnvioWhatsApp.delete({ where: { id: fallaCreada.id } });
    fallaCreada = null;
    const fallasVacio = await prisma.fallaEnvioWhatsApp.findMany({
      where: { empresaId: empresaDemo.id, creadoEn: { gte: desdeSieteDias } },
    });
    if (fallasVacio.length !== 0) {
      throw new Error('❌ Después de borrar la fila de prueba, seguían apareciendo fallas -- revisar.');
    }
    console.log('✅ Sin fallas recientes, el banner no se mostraría (alertaWhatsApp = null).');
  } finally {
    if (fallaCreada) {
      await prisma.fallaEnvioWhatsApp.delete({ where: { id: fallaCreada.id } }).catch(() => {});
      console.log('\n🧹 Fila de prueba limpiada.');
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
