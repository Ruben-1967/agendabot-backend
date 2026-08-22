/**
 * Migración puntual (ficha dinámica por rubro en el panel): reescribe
 * RubroTemplate.camposFicha del formato plano {clave: "string"|"number"}
 * a un formato con schema explícito {grupos: [{titulo, campos: [{path,
 * label, tipo, step?, placeholder?}]}]}, que es lo que ahora consume
 * FormularioAtencion en agendabot-panel/src/pages/admin/Clientes.jsx para
 * renderizar el formulario y el historial de forma genérica.
 *
 * `path` es un array porque algunos campos van anidados en fichaJson
 * (ej. Óptica guarda {od: {esfera, ...}, oi: {...}}) — mismo formato que
 * ya usan obtenerValorAnidado/setValorAnidado en el panel.
 *
 * No migra AtencionClinica.fichaJson existente — solo cambia el SCHEMA
 * (RubroTemplate.camposFicha), decisión confirmada por Ruben. Los
 * fichaJson ya guardados siguen leyéndose igual porque los `path` para
 * Óptica reproducen exactamente su estructura anterior (od/oi/dp).
 *
 * Uso: node scripts/_migrar-camposficha-a-grupos.js
 */
const prisma = require('../src/lib/prisma');

const NUEVOS_CAMPOS_FICHA = {
  optica: {
    grupos: [
      {
        titulo: 'OD (Ojo Derecho)',
        campos: [
          { path: ['od', 'esfera'], label: 'Esfera', tipo: 'number', step: 0.25 },
          { path: ['od', 'cilindro'], label: 'Cilindro', tipo: 'number', step: 0.25 },
          { path: ['od', 'eje'], label: 'Eje (°)', tipo: 'number' },
          { path: ['od', 'adicion'], label: 'Adición', tipo: 'number', step: 0.25 },
        ],
      },
      {
        titulo: 'OI (Ojo Izquierdo)',
        campos: [
          { path: ['oi', 'esfera'], label: 'Esfera', tipo: 'number', step: 0.25 },
          { path: ['oi', 'cilindro'], label: 'Cilindro', tipo: 'number', step: 0.25 },
          { path: ['oi', 'eje'], label: 'Eje (°)', tipo: 'number' },
          { path: ['oi', 'adicion'], label: 'Adición', tipo: 'number', step: 0.25 },
        ],
      },
      {
        titulo: 'Otros parámetros',
        campos: [{ path: ['dp'], label: 'DP (Distancia Pupilar)', tipo: 'text', placeholder: 'ej. 64' }],
      },
    ],
  },
  belleza_estetica_bienestar: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['alergias'], label: 'Alergias', tipo: 'text' },
          { path: ['tipoPiel'], label: 'Tipo de piel', tipo: 'text' },
          { path: ['tratamientoActivo'], label: 'Tratamiento activo', tipo: 'text' },
          { path: ['profesionalResponsable'], label: 'Profesional responsable', tipo: 'text' },
        ],
      },
    ],
  },
  salud_privada: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['medicamentosActuales'], label: 'Medicamentos actuales', tipo: 'text' },
          { path: ['antecedentesRelevantes'], label: 'Antecedentes relevantes', tipo: 'text' },
          { path: ['profesionalResponsable'], label: 'Profesional responsable', tipo: 'text' },
        ],
      },
    ],
  },
  construccion_mantenimiento: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['tipoInmueble'], label: 'Tipo de inmueble', tipo: 'text' },
          { path: ['equipoInstalado'], label: 'Equipo instalado', tipo: 'text' },
          { path: ['direccionServicio'], label: 'Dirección del servicio', tipo: 'text' },
        ],
      },
    ],
  },
  servicios_profesionales: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['areaAsesoria'], label: 'Área de asesoría', tipo: 'text' },
          { path: ['empresaCliente'], label: 'Empresa cliente', tipo: 'text' },
          { path: ['profesionalResponsable'], label: 'Profesional responsable', tipo: 'text' },
        ],
      },
    ],
  },
  gastronomia_reservas: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['ocasionEspecial'], label: 'Ocasión especial', tipo: 'text' },
          { path: ['preferenciaMesa'], label: 'Preferencia de mesa', tipo: 'text' },
          { path: ['restriccionAlimentaria'], label: 'Restricción alimentaria', tipo: 'text' },
        ],
      },
    ],
  },
  creatividad_marketing: {
    grupos: [
      {
        titulo: 'Datos de la ficha',
        campos: [
          { path: ['empresaCliente'], label: 'Empresa cliente', tipo: 'text' },
          { path: ['proyectoActivo'], label: 'Proyecto activo', tipo: 'text' },
          { path: ['profesionalResponsable'], label: 'Profesional responsable', tipo: 'text' },
        ],
      },
    ],
  },
  // Rubros sin campos de ficha propios hoy — quedan con grupos vacíos
  // (antes eran {}, con el mismo efecto: ninguna sección dinámica extra).
  comercio_minorista: { grupos: [] },
  gastronomia_delivery: { grupos: [] },
  logistica_delivery: { grupos: [] },
  manufactura_artesania: { grupos: [] },
  otro: { grupos: [] },
};

async function main() {
  for (const [clave, camposFicha] of Object.entries(NUEVOS_CAMPOS_FICHA)) {
    const actualizado = await prisma.rubroTemplate.update({ where: { clave }, data: { camposFicha } });
    console.log(clave, '->', JSON.stringify(actualizado.camposFicha));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
