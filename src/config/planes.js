// Límites del Catálogo Visual por plan de suscripción. Centralizados acá (y
// no hardcodeados en la ruta) porque una empresa puede migrar de plan, y el
// mismo PlanSuscripcion (schema.prisma) se usa en otros puntos del código
// para gatear funcionalidad (ej. ocultarConfiguracionAgenda en el panel).
const LIMITES_CATALOGO_POR_PLAN = {
  PLAN_A: { maxPorCategoria: 6, maxTotal: 24 },
  PLAN_B: { maxPorCategoria: 12, maxTotal: 48 },
  PLAN_C: { maxPorCategoria: 18, maxTotal: 72 },
  PLAN_INICIO_LEGACY: { maxPorCategoria: 6, maxTotal: 24 }, // mismo tope que Plan A
};

module.exports = { LIMITES_CATALOGO_POR_PLAN };
