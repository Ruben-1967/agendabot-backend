/**
 * Asigna (o reasigna) el teléfono de un prospecto a una Empresa de demo,
 * para que el bot de WhatsApp responda automáticamente como ese negocio
 * apenas el prospecto escriba, sin preguntarle nada primero.
 *
 * Uso:
 *   node scripts/asignar-demo.js <telefono> <empresaDemoId> [nombreProspecto]
 *
 * Ejemplo:
 *   node scripts/asignar-demo.js 56912345678 panaderia-demo-seed-id "Juan Pérez (Panadería Los Aromos)"
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const [telefono, empresaDemoId, nombreProspecto] = process.argv.slice(2);

  if (!telefono || !empresaDemoId) {
    console.error('Uso: node scripts/asignar-demo.js <telefono> <empresaDemoId> [nombreProspecto]');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaDemoId } });
  if (!empresa) {
    console.error(`No existe ninguna Empresa con id "${empresaDemoId}"`);
    process.exit(1);
  }
  if (!empresa.esDemo) {
    console.warn(
      `Advertencia: la empresa "${empresa.nombre}" no está marcada como esDemo=true. ` +
      `¿Seguro que es una empresa de demo y no un cliente real? Continuando de todos modos...`
    );
  }

  const telefonoLimpio = telefono.replace(/\D/g, ''); // solo dígitos, sin '+' ni espacios

  const asignacion = await prisma.demoAsignada.upsert({
    where: { telefono: telefonoLimpio },
    update: { empresaDemoId: empresa.id, nombreProspecto: nombreProspecto || null },
    create: { telefono: telefonoLimpio, empresaDemoId: empresa.id, nombreProspecto: nombreProspecto || null },
  });

  console.log(
    `Listo: el teléfono ${telefonoLimpio} ahora simula a "${empresa.nombre}" ` +
    `${nombreProspecto ? `(prospecto: ${nombreProspecto})` : ''}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Error asignando demo:', error);
  process.exit(1);
});
