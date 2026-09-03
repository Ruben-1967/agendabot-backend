#!/usr/bin/env node
/**
 * Diagnóstico de solo lectura: cuenta los mensajes de "servicio" (respuestas
 * del bot/admin dentro de la ventana de 24h, rol 'asistente'/'admin') que
 * cada empresa real mandó en los últimos 30 días — para proyectar el gasto
 * mensual cuando Meta empiece a cobrar "service messages" (1 de octubre de
 * 2026). No cuenta mensajes de plantilla (esos ya se cobran aparte,
 * categoría Marketing/Utility/Authentication, sin relación a este cambio).
 *
 * Uso (Render Shell): node scripts/_contar-mensajes-servicio-por-empresa.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const DIAS = 30;

async function main() {
  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);

  const empresas = await prisma.empresa.findMany({
    where: { esDemo: false, whatsappNumeroId: { not: null } },
    select: { id: true, nombre: true },
  });

  for (const empresa of empresas) {
    const conversaciones = await prisma.conversacion.findMany({
      where: { empresaId: empresa.id },
      select: { mensajes: true },
    });

    let mensajesServicio = 0;
    let conversacionesConActividad = 0;

    for (const conv of conversaciones) {
      const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
      const enVentana = mensajes.filter((m) => {
        if (m.rol !== 'asistente' && m.rol !== 'admin') return false;
        // Excluye mensajes de plantilla (ya identificados con ese prefijo en
        // otros jobs, ej. recordatoriosFicha.js) — esos se cobran aparte.
        if (typeof m.contenido === 'string' && m.contenido.startsWith('[Plantilla')) return false;
        const fecha = new Date(m.timestamp);
        return fecha >= desde;
      });
      mensajesServicio += enVentana.length;
      if (enVentana.length > 0) conversacionesConActividad++;
    }

    console.log(`${empresa.nombre}: ${mensajesServicio} mensajes de servicio en los últimos ${DIAS} días, en ${conversacionesConActividad} conversaciones distintas.`);
  }
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
