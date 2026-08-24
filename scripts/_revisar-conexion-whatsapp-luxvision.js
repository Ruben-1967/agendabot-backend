/**
 * Diagnostico puntual: revisa si algun intento reciente de Embedded
 * Signup / Coexistence dejo algo guardado para la empresa de Luxvision
 * Chile, y si el numero 958849432 aparece en cualquier Empresa.
 *
 * No imprime el whatsappToken en si (esta cifrado ademas), solo si esta
 * presente o no.
 *
 * Uso: node scripts/_revisar-conexion-whatsapp-luxvision.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const porNombre = await prisma.empresa.findMany({
    where: { nombre: { contains: 'Luxvision', mode: 'insensitive' } },
    select: {
      id: true, nombre: true, creadoEn: true,
      whatsappNumeroId: true, whatsappWabaId: true, whatsappPhoneNumber: true, whatsappToken: true,
    },
  });

  console.log('=== Empresas con "Luxvision" en el nombre ===');
  for (const e of porNombre) {
    console.log(JSON.stringify({
      id: e.id,
      nombre: e.nombre,
      creadoEn: e.creadoEn,
      whatsappNumeroId: e.whatsappNumeroId,
      whatsappWabaId: e.whatsappWabaId,
      whatsappPhoneNumber: e.whatsappPhoneNumber,
      tieneTokenGuardado: Boolean(e.whatsappToken),
    }, null, 2));
  }
  if (porNombre.length === 0) console.log('(ninguna)');

  console.log('\n=== Buscando "958849432" en whatsappPhoneNumber de CUALQUIER empresa ===');
  const porNumero = await prisma.empresa.findMany({
    where: { whatsappPhoneNumber: { contains: '958849432' } },
    select: { id: true, nombre: true, whatsappPhoneNumber: true, whatsappNumeroId: true, creadoEn: true },
  });
  console.log(porNumero.length === 0 ? '(ninguna empresa tiene ese número guardado)' : JSON.stringify(porNumero, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
