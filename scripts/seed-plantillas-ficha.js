/**
 * Siembra el catálogo inicial de PlantillaFicha (Fichas dinámicas por
 * servicio). "Óptica - Receta" migra el camposFicha REAL de Ahorróptica,
 * sin modificarlo -- hardcodeado acá (no vía lookup a RubroTemplate clave
 * 'optica', porque esa fila NO existe en agendabot_db_staging, solo en
 * producción; confirmado con Ruben vía consulta directa en el shell de
 * Render de producción). "Kinesiología" usa el draft aprobado. Idempotente
 * (no duplica si ya existen por nombre).
 *
 * Uso: node scripts/seed-plantillas-ficha.js
 */
const prisma = require('../src/lib/prisma');

// Copiado literal de RubroTemplate.camposFicha (clave 'optica') en producción,
// vía consulta directa que corrió Ruben -- no modificar.
const CAMPOS_FICHA_OPTICA_REAL = {
  od: { eje: 'number', esfera: 'number', adicion: 'number', cilindro: 'number' },
  oi: { eje: 'number', esfera: 'number', adicion: 'number', cilindro: 'number' },
};

async function main() {
  const existenteOptica = await prisma.plantillaFicha.findFirst({ where: { nombre: 'Óptica - Receta' } });
  if (existenteOptica) {
    console.log('Óptica - Receta ya existe, no se duplica:', existenteOptica.id);
  } else {
    const optica = await prisma.plantillaFicha.create({
      data: {
        nombre: 'Óptica - Receta',
        camposFicha: CAMPOS_FICHA_OPTICA_REAL,
        rubroSugerido: 'optica',
      },
    });
    console.log('Óptica - Receta creada:', optica.id, JSON.stringify(optica.camposFicha));
  }

  const existenteKine = await prisma.plantillaFicha.findFirst({ where: { nombre: 'Kinesiología' } });
  if (existenteKine) {
    console.log('Kinesiología ya existe, no se duplica:', existenteKine.id);
  } else {
    const kinesiologia = await prisma.plantillaFicha.create({
      data: {
        nombre: 'Kinesiología',
        camposFicha: {
          motivoConsulta: 'string',
          zonaAfectada: 'string',
          diagnostico: 'string',
          planTratamiento: 'string',
          sesionesRecomendadas: 'number',
        },
        rubroSugerido: 'salud_privada',
      },
    });
    console.log('Kinesiología creada:', kinesiologia.id, JSON.stringify(kinesiologia.camposFicha));
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
