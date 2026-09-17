#!/usr/bin/env node
// Uso puntual: diagnostica el reporte real del usuario (2026-09-17, prueba
// en vivo por WhatsApp de Ahorróptica): al escribir "Hola", el bot
// respondió con un menú numerado de "3 opciones" (Agendar hora / Cotizar
// una receta / Chatear con un ejecutivo) -- "Cotizar una receta" no
// corresponde a ningún Servicio real ni a ninguna tool existente, así que
// probablemente es un menú INVENTADO por Claude (mismo patrón que
// pareceMenuDeOpcionesSinHerramienta ya detecta para negocios con 2+
// servicios, pero ese heurístico se desactiva a propósito para negocios
// con 0 o 1 servicio real -- Ahorróptica tiene exactamente 1).
//
// Imprime: los Servicio reales activos de Ahorróptica (para confirmar qué
// DEBERÍA mostrar el bot), y el historial + reservaEnCurso de la
// conversación real del teléfono de prueba.
//
// Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   TELEFONO=56984084321 node scripts/_diagnostico-menu-inventado-bienvenida-ahoroptica.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const telefono = process.env.TELEFONO;
  if (!telefono) {
    throw new Error('Falta TELEFONO -- correr como: TELEFONO="56984084321" node scripts/_diagnostico-menu-inventado-bienvenida-ahoroptica.js');
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log(`Empresa: ${empresa.nombre} (${empresa.sucursal || 'sin sucursal'})`);
  console.log(`requiereRut: ${empresa.requiereRut}`);

  const serviciosReales = await prisma.servicio.findMany({
    where: { empresaId: EMPRESA_ID, activo: true },
    orderBy: { nombre: 'asc' },
  });
  console.log(`\nServicio reales ACTIVOS (${serviciosReales.length}):`);
  for (const s of serviciosReales) {
    console.log(`  - "${s.nombre}" (id: ${s.id}, requiereProfesionalEspecifico: ${s.requiereProfesionalEspecifico})`);
  }
  if (serviciosReales.length === 0) {
    console.log('  (ninguno -- el bot caería al listado genérico del rubro)');
    console.log('  rubroTemplate.serviciosBase:', JSON.stringify(empresa.rubroTemplate?.serviciosBase));
  }

  const conversacion = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono } });
  if (!conversacion) {
    console.log(`\nNo se encontró ninguna Conversacion para "${telefono}".`);
    return;
  }

  console.log(`\nConversacion ${conversacion.id} — canal: ${conversacion.canal} — pausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn || 'null'}`);
  console.log('reservaEnCurso:', JSON.stringify(conversacion.reservaEnCurso, null, 2));
  console.log(`\nHistorial (${conversacion.mensajes?.length || 0} turnos):`);
  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  for (const m of mensajes) {
    const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
    console.log(`[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
