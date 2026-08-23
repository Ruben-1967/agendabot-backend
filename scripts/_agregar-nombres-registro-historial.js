/**
 * Migración puntual (ficha dinámica por rubro): agrega nombreRegistro /
 * nombreHistorial a RubroTemplate.camposFicha, para que el panel use un
 * nombre de tab acorde al rubro ("Receta" en vez de "Registro", etc.) en
 * vez del genérico "Registro"/"Historial" fijo. Solo agrega estas dos
 * claves — no toca `grupos` (usa spread sobre el camposFicha actual).
 *
 * Uso: node scripts/_agregar-nombres-registro-historial.js
 */
const prisma = require('../src/lib/prisma');

const NOMBRES_POR_RUBRO = {
  optica: { nombreRegistro: 'Receta', nombreHistorial: 'Recetas anteriores' },
  salud_privada: { nombreRegistro: 'Consulta', nombreHistorial: 'Historial médico' },
  belleza_estetica_bienestar: { nombreRegistro: 'Sesión', nombreHistorial: 'Historial de sesiones' },
  construccion_mantenimiento: { nombreRegistro: 'Visita técnica', nombreHistorial: 'Visitas anteriores' },
  servicios_profesionales: { nombreRegistro: 'Reunión', nombreHistorial: 'Reuniones anteriores' },
  gastronomia_reservas: { nombreRegistro: 'Visita', nombreHistorial: 'Visitas anteriores' },
  // creatividad_marketing y los rubros sin campos propios (comercio_minorista,
  // gastronomia_delivery, logistica_delivery, manufactura_artesania, otro) se
  // quedan con el genérico "Registro"/"Historial" — decisión confirmada por Ruben.
};

async function main() {
  for (const [clave, nombres] of Object.entries(NOMBRES_POR_RUBRO)) {
    const rubro = await prisma.rubroTemplate.findUnique({ where: { clave } });
    if (!rubro) throw new Error(`No existe RubroTemplate con clave ${clave}`);
    const camposFichaActualizado = { ...rubro.camposFicha, ...nombres };
    const actualizado = await prisma.rubroTemplate.update({
      where: { clave },
      data: { camposFicha: camposFichaActualizado },
    });
    console.log(clave, '->', JSON.stringify(actualizado.camposFicha));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
