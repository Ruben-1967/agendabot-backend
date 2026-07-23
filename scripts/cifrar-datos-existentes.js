// Cifra los datos SENSIBLES que ya existen en texto plano desde antes de
// este cambio (whatsappToken, googleRefreshToken, RUT). Se corre UNA sola
// vez, manualmente, desde la Shell de Render. Es seguro volver a correrlo
// si algo falla a mitad de camino — no duplica ni rompe nada.

const prisma = require('../src/lib/prisma');

async function main() {
  const empresas = await prisma.empresa.findMany({
    select: { id: true, nombre: true, whatsappToken: true, googleRefreshToken: true },
  });

  let empresasActualizadas = 0;
  for (const empresa of empresas) {
    if (!empresa.whatsappToken && !empresa.googleRefreshToken) continue;
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: {
        ...(empresa.whatsappToken && { whatsappToken: empresa.whatsappToken }),
        ...(empresa.googleRefreshToken && { googleRefreshToken: empresa.googleRefreshToken }),
      },
    });
    empresasActualizadas++;
    console.log(`Empresa cifrada: ${empresa.nombre}`);
  }

  const clientes = await prisma.cliente.findMany({ select: { id: true, rut: true } });

  let clientesActualizados = 0;
  for (const cliente of clientes) {
    if (!cliente.rut) continue;
    await prisma.cliente.update({ where: { id: cliente.id }, data: { rut: cliente.rut } });
    clientesActualizados++;
  }

  console.log(`\nListo.\nEmpresas con campos cifrados: ${empresasActualizadas}\nClientes con RUT cifrado: ${clientesActualizados}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error en la migración de cifrado:', err);
  process.exit(1);
});