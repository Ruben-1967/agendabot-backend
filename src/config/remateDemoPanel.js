// Remate de venta de la demo comercial: después de mostrar el Catálogo
// Visual de un rubro, el bot cierra con una captura curada del panel de
// administración ("y esto lo administras tú mismo"). Es un asset estático
// versionado en el repo (assets/demo-panel/, servido por express.static en
// server.js) — a diferencia del Catálogo Visual real, esto no pasa por
// Cloudinary porque nunca lo carga un negocio ni cambia en runtime.
//
// Qué pantalla se captura para cada rubro NO es la misma para todos —
// se eligió según qué dolor resuelve mejor para ese tipo de negocio, sin
// repetir el Catálogo Visual (ya se mostraron fotos ahí, sería redundante).
// Mapeo decidido con Ruben:
//   Óptica, Salud Privada                                  -> Pacientes/clientes
//   Belleza/Estética, Servicios Profesionales, Construcción -> Configuración de agenda
//   Gastronomía-Reservas, Creatividad/Marketing, Otro       -> Panel inicial (dashboard)
//
// Capturas reales (no placeholders) tomadas por Ruben desde su celular
// contra las empresas ficticias de scripts/seed-empresas-capturas-remate.js
// (esDemo:true, datos de ejemplo — nunca datos reales de clientes).
const BASE_URL_BACKEND = 'https://agendabot-backend-bbw5.onrender.com';

const TEXTO_REMATE_GENERICO = 'Y esto lo administras tú mismo en minutos desde tu panel 👇';

const REMATE_PANEL_POR_RUBRO = {
  // Pantalla: Pacientes/clientes
  optica: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/optica-remate.jpeg`,
  },
  salud_privada: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/salud-privada-remate.jpeg`,
  },

  // Pantalla: Configuración de agenda
  belleza_estetica_bienestar: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/belleza-remate.jpeg`,
  },
  servicios_profesionales: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/servicios-profesionales-remate.jpeg`,
  },
  construccion_mantenimiento: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/construccion-remate.jpeg`,
  },

  // Pantalla: Panel inicial (dashboard)
  gastronomia_reservas: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/gastronomia-reservas-remate.jpeg`,
  },
  creatividad_marketing: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/creatividad-marketing-remate.jpeg`,
  },
  otro: {
    texto: TEXTO_REMATE_GENERICO,
    imagenUrl: `${BASE_URL_BACKEND}/assets/demo-panel/otro-remate.jpeg`,
  },
};

// Cierre elaborado, encadenado determinísticamente justo después de la
// imagen de remate (ver server.js, bloque catalogo_imagenes_demo) — mismo
// texto para los 8 rubros, no varía como el remate visual.
const CIERRE_ELABORADO_DEMO =
  'Y lo mejor de todo: nunca más pierdes un cliente por no responder a tiempo — el bot agenda, muestra tu catálogo y atiende consultas 24/7, aunque estés durmiendo o atendiendo a otra persona. Y tú sigues teniendo el control total desde tu panel.';

module.exports = { REMATE_PANEL_POR_RUBRO, CIERRE_ELABORADO_DEMO };
