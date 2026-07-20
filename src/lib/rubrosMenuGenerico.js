// Plantillas para el menú de rubros que ve un número DESCONOCIDO al
// escribirle al número de demo (nadie lo asignó todavía). Cada elección
// crea una Empresa PRIVADA nueva para ese teléfono — nunca se reutiliza
// la misma fila entre distintos prospectos (ver incidente Luxvision/QROLLS).

const RUBROS_MENU_GENERICO = [
  // ---- Agendamiento (reactivo) ----
  { id: 'rubro_optica', titulo: 'Óptica', descripcion: 'Agendamiento de horas', claveRubro: 'optica', nombreEmpresa: 'Óptica Demo' },
  { id: 'rubro_estetica', titulo: 'Centro estético', descripcion: 'Agendamiento de horas', claveRubro: 'centro_estetico', nombreEmpresa: 'Centro de Estética Demo' },
  { id: 'rubro_salud', titulo: 'Salud independiente', descripcion: 'Agendamiento de horas', claveRubro: 'salud_independiente', nombreEmpresa: 'Salud Independiente Demo' },
  { id: 'rubro_mantencion', titulo: 'Mantención técnica', descripcion: 'Agendamiento de horas', claveRubro: 'mantencion_tecnica', nombreEmpresa: 'Mantención Técnica Demo' },

  // ---- Catálogo rotativo (proactivo) ----
  {
    id: 'rubro_pasteleria', titulo: 'Pastelería', descripcion: 'Catálogo por WhatsApp', claveRubro: 'catalogo_rotativo', nombreEmpresa: 'Pastelería Demo',
    productos: [
      { nombre: 'Torta de chocolate individual', precio: 3990 },
      { nombre: 'Kuchen de manzana (porción)', precio: 3200 },
      { nombre: 'Brownie clásico', precio: 2800 },
      { nombre: 'Cheesecake frutos rojos (porción)', precio: 3600 },
      { nombre: 'Caja mixta de pastelitos (6 unidades)', precio: 9900 },
    ],
  },
  {
    id: 'rubro_delivery', titulo: 'Delivery', descripcion: 'Catálogo por WhatsApp', claveRubro: 'catalogo_rotativo', nombreEmpresa: 'Delivery Demo',
    productos: [
      { nombre: 'Combo hamburguesa + papas + bebida', precio: 6990 },
      { nombre: 'Pizza familiar mixta', precio: 12990 },
      { nombre: 'Sushi 20 piezas variado', precio: 14990 },
      { nombre: 'Bebida 1.5L', precio: 2200 },
      { nombre: 'Papas fritas porción grande', precio: 3500 },
    ],
  },
  {
    id: 'rubro_carniceria', titulo: 'Carnicería', descripcion: 'Catálogo por WhatsApp', claveRubro: 'catalogo_rotativo', nombreEmpresa: 'Carnicería Demo',
    productos: [
      { nombre: 'Lomo vetado (kg)', precio: 9990 },
      { nombre: 'Pollo entero (kg)', precio: 3490 },
      { nombre: 'Costillar de cerdo (kg)', precio: 6990 },
      { nombre: 'Chorizo parrillero (6 unidades)', precio: 4990 },
      { nombre: 'Vacuno molido (kg)', precio: 5990 },
    ],
  },
  {
    id: 'rubro_restaurant', titulo: 'Restaurant', descripcion: 'Catálogo por WhatsApp', claveRubro: 'catalogo_rotativo', nombreEmpresa: 'Restaurant Demo',
    productos: [
      { nombre: 'Menú ejecutivo del día', precio: 6990 },
      { nombre: 'Lomo a lo pobre', precio: 9990 },
      { nombre: 'Ensalada César', precio: 5990 },
      { nombre: 'Jugo natural', precio: 2500 },
      { nombre: 'Postre de la casa', precio: 3500 },
    ],
  },
];

module.exports = { RUBROS_MENU_GENERICO };