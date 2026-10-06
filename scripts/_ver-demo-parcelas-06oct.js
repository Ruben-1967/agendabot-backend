#!/usr/bin/env node
// Uso puntual (2026-10-06): muestra qué tiene configurada la demo
// personalizada de Wladimir (Parcelas San Ramón, 56999988521) -- lo que el bot
// puede decir sobre su negocio sale SOLO de acá: nombre, rubro, servicios,
// dirección, sitio web e "información adicional". Solo lectura.
//
// USO (Shell de Render, producción):
//   node scripts/_ver-demo-parcelas-06oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const TELEFONOS = ['56999988521', '999988521'];

async function main() {
  const demo = await prisma.demoAsignada.findFirst({
    where: { OR: TELEFONOS.map((t) => ({ telefono: { endsWith: t } })) },
    include: { empresaDemo: { include: { rubroTemplate: true } }, vendedor: { select: { nombre: true } } },
  });
  if (!demo) {
    console.log('No se encontró ninguna demo asignada a ese teléfono. Revisar el número o que la demo esté creada.');
    return;
  }
  const e = demo.empresaDemo;
  console.log(`DemoAsignada ${demo.id} | telefono=${demo.telefono} | prospecto="${demo.nombreProspecto}" | origen=${demo.origenDemo} | vendedor=${demo.vendedor?.nombre || '-'} | eliminada=${demo.eliminadoEn ? 'sí' : 'no'}`);
  console.log(`paso actual=${demo.paso} | turnos ya simulados=${Array.isArray(demo.historialSimulacion) ? demo.historialSimulacion.length : 0}`);
  console.log(`\nEmpresa de la demo: "${e.nombre}"`);
  console.log(`Rubro: ${e.rubroTemplate?.nombre || '(sin rubro)'} | modoOperacion=${e.rubroTemplate?.modoOperacion}`);
  console.log(`Dirección: ${e.direccion || '(vacía)'}`);
  console.log(`Sitio web: ${e.sitioWeb || '(vacío)'}`);
  console.log(`\nInformación adicional que el bot puede citar:\n${e.informacionAdicional ? e.informacionAdicional : '(VACÍA -- el bot no sabrá nada específico del negocio)'}`);

  const servicios = await prisma.servicio.findMany({ where: { empresaId: e.id, activo: true }, select: { nombre: true } });
  console.log(`\nServicios activos de la demo (${servicios.length}): ${servicios.map((s) => s.nombre).join(' | ') || '(ninguno -- usará los servicios base del rubro)'}`);
  if (Array.isArray(e.rubroTemplate?.serviciosBase)) console.log(`Servicios base del rubro: ${e.rubroTemplate.serviciosBase.join(' | ')}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
