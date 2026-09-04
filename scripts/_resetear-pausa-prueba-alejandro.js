// Resetea manualmente el estado de pausa-por-humano de 3 conversaciones de
// PRUEBA en Alejandro Barber, para no tener que esperar las 2h reales de
// silencio del cliente durante las pruebas de hoy (2026-09-04). Mismos 3
// campos que limpia la reactivación real (ver jobs/pausaCoexistence.js) —
// no toca nada más.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const NUMEROS = ['+56984084321', '+56927272707', '+56927602910'];
const VARIANTES = NUMEROS.flatMap((n) => [n, n.replace('+', '')]);

async function main() {
  const empresa = await prisma.empresa.findFirst({ where: { nombre: { contains: 'Barber', mode: 'insensitive' } } });
  if (!empresa) {
    console.error('No se encontró una empresa con "Barber" en el nombre.');
    process.exit(1);
  }
  console.log('Empresa:', empresa.nombre, empresa.id);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: empresa.id, telefono: { in: VARIANTES } },
    select: { id: true, telefono: true, pausadaPorHumanoEn: true },
  });
  console.log('Conversaciones encontradas:', conversaciones);

  if (conversaciones.length === 0) {
    console.log('No se encontró ninguna conversación con esos números para esta empresa.');
    return;
  }

  const resultado = await prisma.conversacion.updateMany({
    where: { id: { in: conversaciones.map((c) => c.id) } },
    data: { pausadaPorHumanoEn: null, contencionEnviadaEn: null, alertaUrgenteEnviadaEn: null },
  });
  console.log('Reseteadas:', resultado.count);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
