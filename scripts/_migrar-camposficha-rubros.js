/**
 * Migración puntual (Fichas dinámicas por servicio): consolida los campos
 * "profesional*" en un único profesionalResponsable reutilizable, y elimina
 * los 4 campos de fecha redundantes (proximoControl/proximaReunion/
 * proximaEntrega/garantiaHasta), ya que AtencionClinica.fechaProximaCitaFijada
 * es ahora la única fuente de verdad para el recordatorio. Decisión
 * confirmada por Ruben. camposFicha no se lee en ningún frontend hoy, así
 * que renombrar claves es seguro.
 *
 * Uso: node scripts/_migrar-camposficha-rubros.js
 */
const prisma = require('../src/lib/prisma');

const NUEVOS_CAMPOS = {
  belleza_estetica_bienestar: {
    alergias: 'string',
    tipoPiel: 'string',
    tratamientoActivo: 'string',
    profesionalResponsable: 'string',
  },
  salud_privada: {
    profesionalResponsable: 'string',
    medicamentosActuales: 'string',
    antecedentesRelevantes: 'string',
  },
  construccion_mantenimiento: {
    tipoInmueble: 'string',
    equipoInstalado: 'string',
    direccionServicio: 'string',
  },
  servicios_profesionales: {
    empresaCliente: 'string',
    areaAsesoria: 'string',
    profesionalResponsable: 'string',
  },
  gastronomia_reservas: {
    ocasionEspecial: 'string',
    preferenciaMesa: 'string',
    restriccionAlimentaria: 'string',
  },
  creatividad_marketing: {
    empresaCliente: 'string',
    proyectoActivo: 'string',
    profesionalResponsable: 'string',
  },
};

async function main() {
  for (const [clave, camposFicha] of Object.entries(NUEVOS_CAMPOS)) {
    const actualizado = await prisma.rubroTemplate.update({
      where: { clave },
      data: { camposFicha },
    });
    console.log(clave, '->', JSON.stringify(actualizado.camposFicha));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
