#!/usr/bin/env node
// Uso puntual (una sola corrida): une el login de LuxVision con la Empresa
// real (la que tiene WhatsApp conectado y los 1903 pacientes importados),
// que hasta ahora no tenía ningún Usuario ni Suscripcion asociada.
//
// Mueve:
//   - Usuario contacto@luxvision.cl: empresaId deba7912... -> e277ea9e...
//   - Suscripcion (PLAN_C, pendiente de pago): empresaId deba7912... -> e277ea9e...
//
// La Empresa deba7912... (creada hoy, duplicada, sin WhatsApp ni pacientes)
// queda vacía después de esto -- no se borra, por si acaso.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_VIEJA = 'deba7912-6a28-44ae-8e06-d5bae0a7c1aa'; // Luxvision EIRL -- login+suscripcion, sin whatsapp/pacientes
const EMPRESA_REAL = 'e277ea9e-5793-468c-aa96-e4a2f7457201'; // Luxvision -- whatsapp real + 1903 pacientes

async function main() {
  const usuario = await prisma.usuario.findUnique({ where: { email: 'contacto@luxvision.cl' } });
  if (!usuario || usuario.empresaId !== EMPRESA_VIEJA) {
    console.error('El usuario no está donde se esperaba, se aborta sin tocar nada:', usuario);
    process.exit(1);
  }

  const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId: EMPRESA_VIEJA } });
  if (!suscripcion) {
    console.error('No se encontró la Suscripcion esperada en la empresa vieja, se aborta sin tocar nada.');
    process.exit(1);
  }

  const [usuarioActualizado, suscripcionActualizada] = await prisma.$transaction([
    prisma.usuario.update({ where: { id: usuario.id }, data: { empresaId: EMPRESA_REAL } }),
    prisma.suscripcion.update({ where: { id: suscripcion.id }, data: { empresaId: EMPRESA_REAL } }),
  ]);

  console.log('Usuario movido:', usuarioActualizado.email, '-> empresaId', usuarioActualizado.empresaId);
  console.log('Suscripcion movida:', suscripcionActualizada.id, '-> empresaId', suscripcionActualizada.empresaId);
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
