#!/usr/bin/env node
// Uso puntual: guarda en la Empresa de LuxVision el token de Instagram
// generado a mano desde el App Dashboard de Meta (flujo de "Instagram
// Tester", ver plan de Instagram DM) -- alternativa a
// POST /empresa/instagram/conectar (Embedded Signup), que queda reservado
// para cuando haya Advanced Access y clientes que no sean testers
// agregados a mano. instagramToken se cifra solo (ver src/lib/prisma.js).
//
// El token NUNCA se pega en el chat -- se pasa por variable de entorno al
// correr este script, igual que otros secretos de este proyecto.
//
// USO (Shell de Render, backend de producción):
//   INSTAGRAM_TOKEN=<token generado en Meta> node scripts/_conectar-instagram-luxvision-manual.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const INSTAGRAM_CUENTA_ID = '17841403244285095'; // luxvision.cl, confirmado en el App Dashboard
const INSTAGRAM_USERNAME = 'luxvision.cl';

async function main() {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) {
    throw new Error('Falta INSTAGRAM_TOKEN -- correr como: INSTAGRAM_TOKEN=<token> node scripts/_conectar-instagram-luxvision-manual.js');
  }

  const empresa = await prisma.empresa.update({
    where: { id: EMPRESA_ID_LUXVISION },
    data: {
      instagramCuentaId: INSTAGRAM_CUENTA_ID,
      instagramToken: token,
      instagramUsername: INSTAGRAM_USERNAME,
    },
    select: { id: true, nombre: true, instagramCuentaId: true, instagramUsername: true },
  });

  console.log(`✅ Instagram conectado para ${empresa.nombre}: @${empresa.instagramUsername} (cuenta ${empresa.instagramCuentaId})`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
