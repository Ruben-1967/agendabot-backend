#!/usr/bin/env node
// Uso puntual: cuenta cuántas veces el bot de Ahorróptica cayó en el
// mensaje genérico de error ("tuve un problema procesando tu solicitud")
// en los últimos 7 días, y en qué conversaciones/fechas -- para saber si es
// un caso aislado de hoy o un patrón recurrente. Solo lectura.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const TEXTO_ERROR = 'tuve un problema procesando tu solicitud';

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Ahorróptica', mode: 'insensitive' } },
    select: { id: true, nombre: true },
  });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa "Ahorróptica".');
    process.exit(1);
  }

  const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: empresa.id, actualizadoEn: { gte: hace7Dias } },
    select: { id: true, telefono: true, mensajes: true },
  });

  let totalOcurrencias = 0;
  const porConversacion = [];

  for (const c of conversaciones) {
    if (!Array.isArray(c.mensajes)) continue;
    const ocurrencias = c.mensajes.filter(
      (m) => m.rol === 'asistente' && typeof m.contenido === 'string' && m.contenido.includes(TEXTO_ERROR)
    );
    if (ocurrencias.length > 0) {
      totalOcurrencias += ocurrencias.length;
      porConversacion.push({
        telefono: c.telefono,
        veces: ocurrencias.length,
        timestamps: ocurrencias.map((o) => o.timestamp),
      });
    }
  }

  console.log(`Conversaciones revisadas (últimos 7 días): ${conversaciones.length}`);
  console.log(`Total de veces que cayó en el mensaje de error: ${totalOcurrencias}`);
  console.log(JSON.stringify(porConversacion, null, 2));
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
