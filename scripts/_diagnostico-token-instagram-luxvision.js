#!/usr/bin/env node
// Uso puntual: diagnostica el instagramToken guardado de LuxVision sin
// exponer el valor real -- solo largo, si tiene espacios/saltos de línea, y
// los primeros/últimos caracteres parcialmente enmascarados. Para depurar
// el error "Cannot parse access token" (code 190) al mandar un mensaje.
// Solo lectura.
//
// USO (Shell de Render, backend de producción):
//   node scripts/_diagnostico-token-instagram-luxvision.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID_LUXVISION },
    select: { nombre: true, instagramToken: true, instagramCuentaId: true },
  });

  if (!empresa) throw new Error('No se encontró la Empresa de LuxVision');
  if (!empresa.instagramToken) {
    console.log('instagramToken es null/vacío.');
    return;
  }

  const token = empresa.instagramToken;
  const tieneEspacios = /\s/.test(token);
  const tieneSaltoLinea = /[\r\n]/.test(token);

  console.log(`Empresa: ${empresa.nombre}`);
  console.log(`instagramCuentaId: ${empresa.instagramCuentaId}`);
  console.log(`Largo del token: ${token.length} caracteres`);
  console.log(`¿Contiene espacios?: ${tieneEspacios}`);
  console.log(`¿Contiene saltos de línea?: ${tieneSaltoLinea}`);
  console.log(`Inicio: ${token.slice(0, 8)}...`);
  console.log(`Final: ...${token.slice(-8)}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
