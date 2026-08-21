// Remate de venta de la demo comercial: después de mostrar el Catálogo
// Visual de un rubro, el bot cierra con una captura curada del panel de
// administración ("y esto lo administras tú mismo"). Es un asset estático
// versionado en el repo (assets/demo-panel/, servido por express.static en
// server.js) — a diferencia del Catálogo Visual real, esto no pasa por
// Cloudinary porque nunca lo carga un negocio ni cambia en runtime.
//
// PLACEHOLDERS: las imágenes actuales son un color sólido de relleno. El
// usuario las reemplaza por capturas curadas reales (mockups con datos de
// ejemplo, nunca datos reales de clientes) antes de usar esto con un
// prospecto de verdad.
const BASE_URL_BACKEND = 'https://agendabot-backend-bbw5.onrender.com';

const REMATE_PANEL_POR_RUBRO = {
  optica: {
    texto: 'Y esto lo administras tú mismo en minutos desde tu panel 👇',
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/optica-placeholder.png`,
  },
  belleza_estetica_bienestar: {
    texto: 'Y esto lo administras tú mismo en minutos desde tu panel 👇',
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/belleza-placeholder.png`,
  },
  // Tercer rubro a definir con Ruben (ver checklist) — agregar acá cuando
  // se confirme cuál, con su propia imagen en assets/demo-panel/.
};

module.exports = { REMATE_PANEL_POR_RUBRO };
