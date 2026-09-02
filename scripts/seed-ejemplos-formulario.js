#!/usr/bin/env node
/**
 * Carga RubroTemplate.ejemplosFormulario para todos los rubros — ejemplos
 * de dirección/información adicional/nombre de recurso ficticios pero
 * realistas, tomados del rubro, para reemplazar los placeholders fijos que
 * mostraban datos reales de Ahorróptica sin importar el rubro del negocio.
 *
 * Seguro de correr varias veces (upsert por clave, vía update).
 *
 * Uso: node scripts/seed-ejemplos-formulario.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EJEMPLOS = {
  optica: {
    nombreRecurso: 'Ej. Atención Óptica Central',
    direccion: 'Ej. Av. Independencia #1450, Independencia',
    informacionAdicional: 'Ej. Examen + receta $15.000. $5.000 si compra lentes el mismo día.',
  },
  belleza_estetica_bienestar: {
    nombreRecurso: 'Ej. Salón Bella Vista',
    direccion: 'Ej. Av. Las Condes #8900, Las Condes',
    informacionAdicional: 'Ej. Corte y peinado $12.000. Coloración desde $25.000, según largo de pelo.',
  },
  salud_privada: {
    nombreRecurso: 'Ej. Consulta Dra. Fuentes',
    direccion: 'Ej. Av. Manuel Montt #560, Providencia',
    informacionAdicional: 'Ej. Consulta general $25.000. Incluye receta si corresponde.',
  },
  servicios_profesionales: {
    nombreRecurso: 'Ej. Estudio Jurídico Rivas',
    direccion: 'Ej. Huérfanos #1160, oficina 803, Santiago Centro',
    informacionAdicional: 'Ej. Primera asesoría sin costo, 30 minutos.',
  },
  construccion_mantenimiento: {
    nombreRecurso: 'Ej. Constructora Andes',
    direccion: 'Ej. Camino Real #1200, Puente Alto',
    informacionAdicional: 'Ej. Visita técnica sin costo. Cotización en 24-48h según el trabajo.',
  },
  creatividad_marketing: {
    nombreRecurso: 'Ej. Estudio Creativo Norte',
    direccion: 'Ej. Av. Providencia #2340, oficina 502, Providencia',
    informacionAdicional: 'Ej. Sesión de diseño desde $80.000. Incluye 2 rondas de revisión.',
  },
  gastronomia_reservas: {
    nombreRecurso: 'Ej. Restaurante La Terraza',
    direccion: 'Ej. Av. Vitacura #4200, Vitacura',
    informacionAdicional: 'Ej. Reservas con 24h de anticipación. Menú degustación solo viernes y sábado.',
  },
  otro: {
    nombreRecurso: 'Ej. Mi Negocio',
    direccion: 'Ej. Calle Principal #123, comuna',
    informacionAdicional: 'Ej. Cuéntanos qué precios o promociones quieres que el bot mencione.',
  },
  // Rubros CATALOGO_ROTATIVO: sin nombreRecurso (no tienen RecursoAgendable).
  comercio_minorista: {
    direccion: 'Ej. Av. Kennedy #5413, local 12, Las Condes',
    informacionAdicional: 'Ej. Envíos a todo Santiago en 24-48h. Retiro en tienda disponible.',
  },
  gastronomia_delivery: {
    direccion: 'Ej. Av. Irarrázaval #2100, Ñuñoa',
    informacionAdicional: 'Ej. Delivery gratis sobre $15.000. Pedido mínimo $8.000.',
  },
  logistica_delivery: {
    direccion: 'Ej. Camino a Melipilla #3800, bodega 4, Cerrillos',
    informacionAdicional: 'Ej. Cobertura Región Metropolitana. Retiro programado con 2h de anticipación.',
  },
  manufactura_artesania: {
    direccion: 'Ej. Taller en Barrio Franklin, Santiago',
    informacionAdicional: 'Ej. Piezas personalizadas con 5-7 días hábiles de plazo.',
  },
};

async function main() {
  const rubros = await prisma.rubroTemplate.findMany({ select: { id: true, clave: true } });
  let actualizados = 0;
  for (const rubro of rubros) {
    const ejemplos = EJEMPLOS[rubro.clave];
    if (!ejemplos) {
      console.warn(`Sin ejemplos definidos para clave "${rubro.clave}" — se omite.`);
      continue;
    }
    await prisma.rubroTemplate.update({ where: { id: rubro.id }, data: { ejemplosFormulario: ejemplos } });
    console.log(`"${rubro.clave}" actualizado.`);
    actualizados++;
  }
  console.log(`\n${actualizados}/${rubros.length} rubros actualizados.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR:', e); prisma.$disconnect(); });
