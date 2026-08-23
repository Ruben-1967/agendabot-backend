// Textos fijos del remate de venta de la demo comercial: después de
// mostrar el Catálogo Visual de un rubro, el bot cierra con una captura
// curada del panel de administración ("y esto lo administras tú mismo").
//
// La IMAGEN del remate ya no vive acá — se administra como un
// CatalogoDemoItem más, con categoría reservada "Remate Panel" (ver
// CATEGORIA_REMATE_PANEL en demoEngine.js), subida desde
// /vendedor/admin/catalogo-demo igual que el catálogo real. Esto permite
// reemplazar la captura sin deploy. El TEXTO sí sigue hardcodeado acá,
// igual para los 8 rubros — no varía en sustancia entre rubros, es un
// mensaje genérico de "control total desde tu panel" (decisión de Ruben,
// evita mantener un campo más por rubro sin necesidad real).
const TEXTO_REMATE_GENERICO = 'Y esto lo administras tú mismo en minutos desde tu panel 👇';

// Cierre elaborado, encadenado determinísticamente justo después de la
// imagen de remate (ver server.js, bloque catalogo_imagenes_demo) — mismo
// texto para los 8 rubros, no varía como el remate visual.
const CIERRE_ELABORADO_DEMO =
  'Y lo mejor de todo: nunca más pierdes un cliente por no responder a tiempo — el bot agenda, muestra tu catálogo y atiende consultas 24/7, aunque estés durmiendo o atendiendo a otra persona. Y tú sigues teniendo el control total desde tu panel.';

module.exports = { TEXTO_REMATE_GENERICO, CIERRE_ELABORADO_DEMO };
