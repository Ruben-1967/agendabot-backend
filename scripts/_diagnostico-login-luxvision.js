#!/usr/bin/env node
// Uso puntual: el usuario no puede entrar al panel de LuxVision con
// contacto@luxvision.cl -- revisa si el Usuario existe (el email real
// guardado puede no calzar exacto), si la cuenta está activada
// (tokenActivacion pendiente = nunca definió contraseña), y a qué
// Empresa.telefonoContacto llegaría el link de reset por WhatsApp
// (ver POST /auth/solicitar-reset-password). Solo lectura, no cambia nada.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-login-luxvision.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const usuarios = await prisma.usuario.findMany({
    where: {
      OR: [
        { email: { contains: 'luxvision', mode: 'insensitive' } },
        { empresa: { nombre: { contains: 'luxvision', mode: 'insensitive' } } },
        { empresa: { nombre: { contains: 'luxision', mode: 'insensitive' } } },
      ],
    },
    include: { empresa: true },
  });

  if (usuarios.length === 0) {
    console.log('No se encontró ningún Usuario relacionado a "luxvision".');
    return;
  }

  console.log(`${usuarios.length} usuario(s) encontrado(s):\n`);
  for (const u of usuarios) {
    console.log('='.repeat(60));
    console.log(`Email guardado: "${u.email}"`);
    console.log(`Nombre: ${u.nombre} — Rol: ${u.rol}`);
    console.log(`Empresa: ${u.empresa.nombre} (${u.empresa.sucursal || 'sin sucursal'}) — esDemo: ${u.empresa.esDemo}`);
    console.log(`empresaId: ${u.empresaId}`);
    console.log(`Cuenta activada (definió su propia clave): ${u.tokenActivacion ? 'NO -- tiene tokenActivacion pendiente' : 'sí'}`);
    if (u.tokenActivacion) {
      console.log(`  tokenActivacionExpira: ${u.tokenActivacionExpira ? u.tokenActivacionExpira.toISOString() : 'null'}`);
    }
    console.log(`fechaActivacionCuenta: ${u.fechaActivacionCuenta ? u.fechaActivacionCuenta.toISOString() : 'null (nunca activó)'}`);
    console.log(`Empresa.telefonoContacto (adonde llegaría el link de reset por WhatsApp): ${u.empresa.telefonoContacto || '(vacío -- el reset fallaría en silencio, ver logs)'}`);
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
