#!/usr/bin/env node
// Uso puntual: guarda en la Empresa de LuxVision el Page Access Token de
// Messenger generado a mano desde el App Dashboard de Meta (mismo patrón
// que _conectar-instagram-luxvision-manual.js) -- alternativa a
// POST /empresa/facebook/conectar (Embedded Signup), reservado para cuando
// haya Advanced Access y clientes que no sean testers agregados a mano.
// facebookToken se cifra solo (ver src/lib/prisma.js).
//
// El token NUNCA se pega en el chat -- se pasa por variable de entorno al
// correr este script, igual que otros secretos de este proyecto.
//
// USO (Shell de Render, backend de producción):
//   FACEBOOK_TOKEN=<token generado en Meta> node scripts/_conectar-facebook-luxvision-manual.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const FACEBOOK_PAGINA_ID = '568002613381447'; // "LuxVision Chile", confirmado en Meta Business Suite
const FACEBOOK_PAGINA_NOMBRE = 'LuxVision Chile';

async function main() {
  const token = process.env.FACEBOOK_TOKEN;
  if (!token) {
    throw new Error('Falta FACEBOOK_TOKEN -- correr como: FACEBOOK_TOKEN=<token> node scripts/_conectar-facebook-luxvision-manual.js');
  }

  const empresa = await prisma.empresa.update({
    where: { id: EMPRESA_ID_LUXVISION },
    data: {
      facebookPaginaId: FACEBOOK_PAGINA_ID,
      facebookToken: token,
      facebookPaginaNombre: FACEBOOK_PAGINA_NOMBRE,
    },
    select: { id: true, nombre: true, facebookPaginaId: true, facebookPaginaNombre: true },
  });

  console.log(`✅ Messenger conectado para ${empresa.nombre}: ${empresa.facebookPaginaNombre} (Página ${empresa.facebookPaginaId})`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
