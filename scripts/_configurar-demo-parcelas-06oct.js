#!/usr/bin/env node
// Uso puntual (2026-10-06): carga DATOS DE EJEMPLO en la demo personalizada de
// Wladimir (Parcelas San Ramón, 56999988521) para que pueda probar el bot "como
// si fuera un cliente". El negocio real no entregó datos, así que se inventan
// valores ilustrativos -- y se le indica al bot que, cuando cite uno, aclare
// que es un dato de EJEMPLO (Wladimir es el dueño real del negocio y no debe
// confundirlos con información verídica). Nada de contacto, escrituras ni
// financiamiento: eso se deriva al equipo comercial.
//
// Idempotente: se puede correr de nuevo (actualiza el texto y no duplica los
// servicios). Solo toca la Empresa de ESTA demo (esDemo=true).
//
// USO (Shell de Render, producción):
//   node scripts/_configurar-demo-parcelas-06oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const TELEFONO = '56999988521';

const INFORMACION_ADICIONAL = `IMPORTANTE: todos los datos de abajo son EJEMPLOS ilustrativos para esta demo, no datos reales del negocio. Cada vez que cites uno (tamaños, valores, horarios, ubicación), aclara en pocas palabras que es un dato de ejemplo que se reemplazaría por la información real de Parcelas San Ramón. No inventes nada fuera de esta lista.
Parcelas San Ramón vende parcelas de agrado.
Ubicación (ejemplo): sector rural a unos 40 minutos de la ciudad, con acceso por camino pavimentado.
Tamaños (ejemplo): parcelas de 5.000 m² y de 10.000 m².
Valores (ejemplo): desde $18.000.000 las de 5.000 m². Es un valor referencial: la cotización exacta la entrega el equipo.
Visitas (ejemplo): sábados y domingos entre 10:00 y 17:00, con coordinación previa.
Formas de pago (ejemplo): contado, o pie más cuotas. Las condiciones exactas las detalla el equipo comercial.
Si preguntan por escrituras, contratos, rol, financiamiento o disponibilidad real de una parcela, di que lo confirma el equipo comercial directamente.`;

const SERVICIOS = ['Asesoría de compra', 'Cotización de parcelas', 'Visita a las parcelas'];

async function main() {
  const demo = await prisma.demoAsignada.findFirst({
    where: { telefono: { endsWith: TELEFONO.slice(-9) } },
    include: { empresaDemo: true },
  });
  if (!demo) throw new Error('No se encontró la demo de ese teléfono.');
  if (!demo.empresaDemo.esDemo) throw new Error('La empresa vinculada no es una empresa de demo (esDemo=false) -- no se toca.');

  await prisma.empresa.update({
    where: { id: demo.empresaDemoId },
    data: { informacionAdicional: INFORMACION_ADICIONAL },
  });
  console.log(`✅ Información adicional cargada en "${demo.empresaDemo.nombre}".`);

  const existentes = await prisma.servicio.findMany({ where: { empresaId: demo.empresaDemoId }, select: { nombre: true } });
  const yaTiene = new Set(existentes.map((s) => s.nombre));
  for (const nombre of SERVICIOS) {
    if (yaTiene.has(nombre)) { console.log(`  · "${nombre}" ya existía.`); continue; }
    await prisma.servicio.create({ data: { empresaId: demo.empresaDemoId, nombre, duracionMinutos: 60, activo: true } });
    console.log(`  ✅ Servicio creado: "${nombre}"`);
  }

  // La demo arranca desde cero la próxima vez que Wladimir escriba.
  await prisma.demoAsignada.update({ where: { id: demo.id }, data: { paso: 0, historialSimulacion: [] } });
  console.log('✅ Estado de la demo reiniciado (empieza desde cero).');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
