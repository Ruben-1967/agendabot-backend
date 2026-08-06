/**
 * scripts/seed-rubros-nuevos.js
 *
 * Siembra los 11 RubroTemplate nuevos para el menú de demos comerciales
 * (Óptica ya existe y no se toca). Idempotente: si una clave ya existe,
 * se omite en vez de duplicar o fallar.
 *
 * Uso:
 *   node scripts/seed-rubros-nuevos.js
 */
const prisma = require('../src/lib/prisma');

const RUBROS = [
  {
    clave: 'otro',
    nombre: 'Otro',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: [],
    camposFicha: {},
    automatizacionesBase: {},
  },
  {
    clave: 'belleza_estetica_bienestar',
    nombre: 'Belleza / Estética / Bienestar',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Manicure/Pedicure', 'Corte y peinado', 'Coloración', 'Tratamiento facial', 'Depilación', 'Masaje relajante'],
    camposFicha: {
      tipoPiel: 'string',
      alergias: 'string',
      tratamientoActivo: 'string',
      profesionalHabitual: 'string',
    },
    automatizacionesBase: {},
  },
  {
    clave: 'salud_privada',
    nombre: 'Salud Privada',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Consulta general', 'Control', 'Examen preventivo', 'Terapia/Sesión', 'Certificado médico'],
    camposFicha: {
      antecedentesRelevantes: 'string',
      medicamentosActuales: 'string',
      profesionalTratante: 'string',
      proximoControl: 'date',
    },
    automatizacionesBase: {},
  },
  {
    clave: 'construccion_mantenimiento',
    nombre: 'Construcción / Mantenimiento',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Visita técnica/cotización', 'Reparación general', 'Mantención preventiva', 'Instalación', 'Certificación'],
    camposFicha: {
      direccionServicio: 'string',
      tipoInmueble: 'string',
      equipoInstalado: 'string',
      garantiaHasta: 'date',
    },
    automatizacionesBase: {},
  },
  {
    clave: 'servicios_profesionales',
    nombre: 'Servicios Profesionales / Oficios',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Asesoría inicial', 'Consultoría por hora', 'Revisión de documentos', 'Seguimiento de caso'],
    camposFicha: {
      empresa: 'string',
      areaAsesoria: 'string',
      profesionalAsignado: 'string',
      proximaReunion: 'date',
    },
    automatizacionesBase: {},
  },
  {
    clave: 'gastronomia_reservas',
    nombre: 'Gastronomía y Alimentos — Reservas',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Reserva de mesa', 'Evento privado', 'Menú degustación'],
    camposFicha: {
      preferenciaMesa: 'string',
      restriccionAlimentaria: 'string',
      ocasionEspecial: 'string',
    },
    automatizacionesBase: {},
  },
  {
    clave: 'creatividad_marketing',
    nombre: 'Creatividad / Marketing',
    modoOperacion: 'AGENDAMIENTO',
    serviciosBase: ['Sesión de diseño', 'Consultoría de marca', 'Producción de contenido', 'Reunión de seguimiento'],
    camposFicha: {
      empresa: 'string',
      proyectoActivo: 'string',
      encargadoCuenta: 'string',
      proximaEntrega: 'date',
    },
    automatizacionesBase: {},
  },
  // ---- CATALOGO_ROTATIVO: serviciosBase guarda el catálogo sugerido,
  // con la misma forma {nombre, precio, descripcion} que usa
  // extraccionSitioWeb.js en productosSugeridos — mismo contrato en
  // todo el sistema, sin campo separado. ----
  {
    clave: 'comercio_minorista',
    nombre: 'Comercio Minorista',
    modoOperacion: 'CATALOGO_ROTATIVO',
    serviciosBase: [
      { nombre: 'Camiseta básica', precio: 12990, descripcion: null },
      { nombre: 'Zapatillas urbanas', precio: 34990, descripcion: null },
      { nombre: 'Mochila', precio: 18990, descripcion: null },
      { nombre: 'Audífonos inalámbricos', precio: 24990, descripcion: null },
      { nombre: 'Gorro/Accesorio', precio: 6990, descripcion: null },
    ],
    camposFicha: {},
    automatizacionesBase: {},
  },
  {
    clave: 'gastronomia_delivery',
    nombre: 'Gastronomía y Alimentos — Delivery/Pedidos',
    modoOperacion: 'CATALOGO_ROTATIVO',
    serviciosBase: [
      { nombre: 'Combo almuerzo del día', precio: 6990, descripcion: null },
      { nombre: 'Hamburguesa clásica', precio: 5490, descripcion: null },
      { nombre: 'Ensalada César', precio: 4990, descripcion: null },
      { nombre: 'Jugo natural', precio: 2500, descripcion: null },
      { nombre: 'Postre del día', precio: 3200, descripcion: null },
    ],
    camposFicha: {},
    automatizacionesBase: {},
  },
  {
    clave: 'logistica_delivery',
    nombre: 'Logística / Delivery',
    modoOperacion: 'CATALOGO_ROTATIVO',
    serviciosBase: [
      { nombre: 'Envío mismo día (hasta 5kg)', precio: 4990, descripcion: null },
      { nombre: 'Envío express 2h', precio: 8990, descripcion: null },
      { nombre: 'Envío interregional', precio: 12990, descripcion: null },
      { nombre: 'Retiro en tienda + despacho', precio: 6500, descripcion: null },
    ],
    camposFicha: {},
    automatizacionesBase: {},
  },
  {
    clave: 'manufactura_artesania',
    nombre: 'Manufactura / Artesanía',
    modoOperacion: 'CATALOGO_ROTATIVO',
    serviciosBase: [
      { nombre: 'Pieza artesanal chica', precio: 15990, descripcion: null },
      { nombre: 'Pieza artesanal mediana', precio: 29990, descripcion: null },
      { nombre: 'Pieza personalizada (encargo)', precio: 45990, descripcion: null },
      { nombre: 'Set de regalo', precio: 22990, descripcion: null },
    ],
    camposFicha: {},
    automatizacionesBase: {},
  },
];

async function main() {
  let creados = 0;
  let omitidos = 0;

  for (const rubro of RUBROS) {
    const existente = await prisma.rubroTemplate.findUnique({ where: { clave: rubro.clave } });
    if (existente) {
      console.log(`Omitido (ya existe): ${rubro.clave}`);
      omitidos++;
      continue;
    }

    await prisma.rubroTemplate.create({ data: rubro });
    console.log(`Creado: ${rubro.clave} (${rubro.nombre}) — modo ${rubro.modoOperacion}`);
    creados++;
  }

  console.log(`\nListo. Creados: ${creados}, omitidos (ya existían): ${omitidos}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error sembrando rubros:', error);
  process.exit(1);
});