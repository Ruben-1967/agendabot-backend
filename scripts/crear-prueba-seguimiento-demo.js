// scripts/crear-prueba-seguimiento-demo.js
//
// Crea 4 registros de DemoAsignada (origenDemo: 'organico') cubriendo los
// escenarios que el cron seguimientoDemo.js debe procesar. Idempotente:
// usa upsert por teléfono, se puede correr varias veces sin duplicar.
//
// ⚠️ Antes de correr: revisa que el require de abajo apunte al mismo lugar
// que usan tus otros scripts (ej. scripts/crear-prueba-multiprofesional.js)
// — puede ser '../src/lib/prisma' o similar según cómo esté armado tu
// package.json / estructura de carpetas real.
//
// Uso (🟩 Render Shell, staging):
//   npm exec -- node scripts/crear-prueba-seguimiento-demo.js

const prisma = require('../src/lib/prisma');

const AHORA = new Date();

function hace(horas) {
  return new Date(AHORA.getTime() - horas * 60 * 60 * 1000);
}

async function obtenerOCrearEmpresaDemo() {
  let empresa = await prisma.empresa.findFirst({
    where: { esDemo: true },
    select: { id: true, nombre: true },
  });

  if (empresa) {
    console.log(`Usando empresa demo existente: ${empresa.nombre} (${empresa.id})`);
    return empresa.id;
  }

  console.log('No se encontró ninguna empresa con esDemo:true en staging — creando una liviana...');
  empresa = await prisma.empresa.create({
    data: {
      nombre: 'Óptica Demo Staging',
      esDemo: true,
      // ⚠️ Si tu modelo Empresa tiene otros campos obligatorios (rubro,
      // modoOperacion, etc.), agrégalos acá o el create va a fallar —
      // revisa contra otro script que ya cree empresas, ej. demos.js.
    },
    select: { id: true, nombre: true },
  });

  console.log(`Empresa demo creada: ${empresa.nombre} (${empresa.id})`);
  return empresa.id;
}

async function main() {
  const empresaDemoId = await obtenerOCrearEmpresaDemo();

  const casos = [
    {
      telefono: '+56900000001',
      nombreProspecto: 'PRUEBA - Precio dentro de umbral',
      origenDemo: 'organico',
      intencionPrecioDetectada: true,
      intencionPrecioEn: hace(1.5),
      ultimaInteraccionEn: hace(1.5),
      seguimientosEnviados: 0,
      seguimientoTipo: null,
      seguimientoEnviadoEn: null,
      derivadoAVendedor: false,
      derivadoEn: null,
      motivoDerivacion: null,
    },
    {
      telefono: '+56900000002',
      nombreProspecto: 'PRUEBA - Inactividad dentro de umbral',
      origenDemo: 'organico',
      intencionPrecioDetectada: false,
      intencionPrecioEn: null,
      ultimaInteraccionEn: hace(5),
      seguimientosEnviados: 0,
      seguimientoTipo: null,
      seguimientoEnviadoEn: null,
      derivadoAVendedor: false,
      derivadoEn: null,
      motivoDerivacion: null,
    },
    {
      telefono: '+56900000003',
      nombreProspecto: 'PRUEBA - Fuera de ventana 24h (debe derivar)',
      origenDemo: 'organico',
      intencionPrecioDetectada: false,
      intencionPrecioEn: null,
      ultimaInteraccionEn: hace(25),
      seguimientosEnviados: 0,
      seguimientoTipo: null,
      seguimientoEnviadoEn: null,
      derivadoAVendedor: false,
      derivadoEn: null,
      motivoDerivacion: null,
    },
    {
      telefono: '+56900000004',
      nombreProspecto: 'PRUEBA - Esperando 2do seguimiento',
      origenDemo: 'organico',
      intencionPrecioDetectada: true,
      intencionPrecioEn: hace(10),
      ultimaInteraccionEn: hace(10), // no respondió desde el 1er seguimiento
      seguimientosEnviados: 1,
      seguimientoTipo: 'precio',
      seguimientoEnviadoEn: hace(6),
      derivadoAVendedor: false,
      derivadoEn: null,
      motivoDerivacion: null,
    },
  ];

  for (const caso of casos) {
    const { telefono, ...datos } = caso;

    const resultado = await prisma.demoAsignada.upsert({
      where: { telefono },
      update: datos,
      create: { telefono, ...datos, paso: 'PRUEBA' },
    });

    console.log(`✔ ${caso.nombreProspecto} → ${resultado.telefono} (id: ${resultado.id})`);
  }

  console.log('\nListo. 4 registros de prueba creados/actualizados con origenDemo: organico.');
  console.log('Ahora puedes correr el cron manualmente para ver cómo procesa cada caso:');
  console.log('  npm exec -- node src/jobs/seguimientoDemo.js');
}

main()
  .catch((err) => {
    console.error('Error creando datos de prueba:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));