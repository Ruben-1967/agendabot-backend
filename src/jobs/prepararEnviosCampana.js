// Job programado (Render Cron Job, sugerido cada 10-15 minutos): revisa qué
// CampanaEnvio (catálogo rotativo — panadería, rotisería, etc.) le
// corresponde prepararse hoy según su día de la semana y hora configurados,
// y crea el EnvioRealizado en estado BORRADOR si todavía no existe uno para
// hoy. El envío real (elegir productos y disparar el mensaje) lo hace el
// panadero manualmente desde el panel — este job solo deja el borrador listo.

require('dotenv').config();
const prisma = require('../lib/prisma');

function inicioDeHoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function finDeHoy() {
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  return hoy;
}

function horaActualComoMinutos(ahora) {
  return ahora.getHours() * 60 + ahora.getMinutes();
}

function horaConfiguradaComoMinutos(horaTexto) {
  const [h, m] = horaTexto.split(':').map(Number);
  return h * 60 + m;
}

async function prepararEnviosDeCampanasDelDia() {
  const ahora = new Date();
  const diaSemanaHoy = ahora.getDay(); // 0 = domingo ... 6 = sábado
  const minutosAhora = horaActualComoMinutos(ahora);

  const campanas = await prisma.campanaEnvio.findMany({
    where: { activa: true, diasSemana: { has: diaSemanaHoy } },
    include: { empresa: true },
  });

  let creados = 0;
  let omitidos = 0;

  for (const campana of campanas) {
    const minutosConfigurados = horaConfiguradaComoMinutos(campana.hora);

    // Ya pasó la hora configurada de hoy (con margen: no antes de la hora exacta)
    if (minutosAhora < minutosConfigurados) {
      continue;
    }

    const yaExiste = await prisma.envioRealizado.findFirst({
      where: {
        campanaId: campana.id,
        fechaProgramada: { gte: inicioDeHoy(), lte: finDeHoy() },
      },
    });

    if (yaExiste) {
      omitidos++;
      continue;
    }

    await prisma.envioRealizado.create({
      data: { campanaId: campana.id, fechaProgramada: ahora, estado: 'BORRADOR' },
    });

    creados++;
    console.log(
      `Borrador creado para "${campana.nombre}" (${campana.empresa.nombre}) — ` +
      `el panadero debe elegir productos y enviar desde el panel.`
    );
  }

  console.log(`\nResumen: ${creados} borradores nuevos, ${omitidos} ya existían para hoy.`);
}

prepararEnviosDeCampanasDelDia()
  .catch((err) => {
    console.error('Error general en el job de campañas:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
