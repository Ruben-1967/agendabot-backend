#!/usr/bin/env node
/**
 * Activa el modo informativo SOLO en la Empresa "Multidigital" (la del WhatsApp de anuncios):
 * el bot informa el catálogo y deriva a una persona, sin agendar ni mostrar la lista de
 * servicios de agendar. Además desactiva (activo=false, reversible) el servicio provisorio
 * "Sitio web de una página + 2 correos corporativos" que se había cargado el 20-oct, porque
 * en este modo el catálogo se lee de informacionAdicional.
 *
 * Requiere que la columna Empresa.modoInformativo ya exista (ver ALTER TABLE en la sesión).
 * No toca ninguna otra empresa y no manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_activar-modo-informativo-multidigital-20oct.js
 *   APLICAR=1 node scripts/_activar-modo-informativo-multidigital-20oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const NOMBRE_SERVICIO_PROVISORIO = 'Sitio web de una página + 2 correos corporativos';

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const e = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, modoInformativo: true, informacionAdicional: true, servicios: { select: { id: true, nombre: true, activo: true } } },
  });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');

  console.log(`Empresa: ${e.nombre} | modoInformativo actual: ${e.modoInformativo}`);
  console.log(`Catálogo en informacionAdicional: ${(e.informacionAdicional || '').includes('Catálogo de Multidigital') ? 'sí' : 'NO (corre antes scripts/_cargar-servicio-multidigital-20oct.js)'}`);
  const provisorios = e.servicios.filter((s) => s.activo && s.nombre === NOMBRE_SERVICIO_PROVISORIO);
  console.log(`Servicios: ${e.servicios.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(' | ') || '(ninguno)'}`);

  if (!(e.informacionAdicional || '').includes('Catálogo de Multidigital')) {
    throw new Error('Falta el catálogo en informacionAdicional: sin él el bot no tendría qué listar. No se activa nada.');
  }
  if (e.modoInformativo && provisorios.length === 0) { console.log('\nYa estaba activado: nada que cambiar.'); return; }
  if (!aplicar) { console.log('\nDRY-RUN: no se escribió nada. Para aplicar: APLICAR=1'); return; }

  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { modoInformativo: true } });
  if (provisorios.length) {
    await prisma.servicio.updateMany({ where: { id: { in: provisorios.map((s) => s.id) } }, data: { activo: false } });
  }
  console.log('✅ modoInformativo activado para Multidigital' + (provisorios.length ? ' y servicio provisorio desactivado.' : '.'));
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
