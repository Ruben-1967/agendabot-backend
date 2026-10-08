#!/usr/bin/env node
// Uso puntual (2026-10-08): el dueño pidió que el bot de LuxVision deje de
// ofrecer agendar "Asesoría" y "Cotización" (restos de otro rubro); solo queda la
// atención oftalmológica. NO se borra nada: se marcan activo=false (todas las
// rutas del bot filtran por activo=true, ver claude.js/chatbotEngine.js), así que
// es reversible desde el panel. Solo toca esa Empresa. No manda ningún mensaje.
//
// USO (Shell de Render, producción):
//   node scripts/_desactivar-servicios-luxvision-08oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const A_DESACTIVAR = ['asesoria', 'cotizacion'];

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, whatsappPhoneNumber: true } });
  if (!empresa || !/luxvision/i.test(empresa.nombre)) throw new Error('La Empresa no existe o no es Luxvision -- no se toca nada.');

  const servicios = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID }, select: { id: true, nombre: true, activo: true } });
  console.log('Servicios ANTES:', servicios.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(' | '));

  const objetivo = servicios.filter((s) => s.activo && A_DESACTIVAR.includes(normalizar(s.nombre)));
  if (objetivo.length === 0) {
    console.log('\nNada que desactivar (ya estaban inactivos o no existen con esos nombres).');
  } else {
    await prisma.servicio.updateMany({ where: { id: { in: objetivo.map((s) => s.id) } }, data: { activo: false } });
    console.log(`\n✅ Desactivados: ${objetivo.map((s) => s.nombre).join(', ')}`);
  }

  const despues = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID }, select: { nombre: true, activo: true } });
  const activos = despues.filter((s) => s.activo).map((s) => s.nombre);
  console.log('Servicios DESPUÉS:', despues.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(' | '));
  console.log(`\nEl bot ofrecerá agendar solo: ${activos.join(', ') || '(ninguno -- usaría la lista genérica del rubro)'}`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
