// Asistente 24/7 de sitios web (2026-11-11): cuando el chat se deriva (la persona dejó sus
// datos y el asistente llamó a escalar_a_humano), se le avisa al negocio por correo.
// Se llama sin await desde src/routes/chatWeb.js y nunca lanza: si algo falla, queda en el log.

const { resumirInteresadoWeb } = require('../services/claude');
const { enviarAvisoInteresado } = require('../services/emailInteresadoWeb');
const { _interno: { telefonoDado } } = require('./leadClienteWeb');

// Texto que viene del chat (vía la extracción de la IA): sin saltos ni caracteres de control
// y con largo acotado, porque el nombre va en el asunto del correo.
function limpio(valor, largo = 300) {
  const v = typeof valor === 'string' ? valor.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return v ? v.slice(0, largo) : null;
}

/**
 * @param {Object} p
 * @param {Object} p.prisma
 * @param {Object} p.asistente - config del asistente (src/lib/asistenteWeb.js)
 * @param {string} p.empresaId
 * @param {string} p.telefonoCliente - "web:<sesión>"
 * @param {Object} [p.deps] - inyectables para pruebas: { resumir, enviar }
 */
async function avisarInteresadoWeb({ prisma, asistente, empresaId, telefonoCliente, deps = {} }) {
  const resumir = deps.resumir || resumirInteresadoWeb;
  const enviar = deps.enviar || enviarAvisoInteresado;
  try {
    const conversacion = await prisma.conversacion.findFirst({
      where: { empresaId, telefono: telefonoCliente, canal: 'web' },
      select: { mensajes: true },
    });
    const mensajes = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];
    if (!mensajes.length) return;
    const extraidos = await resumir(mensajes);
    const datos = {
      nombre: limpio(extraidos.nombre, 60),
      telefono: telefonoDado(extraidos.telefono),
      telefonoEscrito: limpio(extraidos.telefono, 40),
      correo: limpio(extraidos.correo, 120),
      necesidad: limpio(extraidos.necesidad),
    };
    await enviar({ asistente, datos, mensajes });
    console.log(`[chat-web] Aviso de interesado enviado (${asistente.titulo}, ${telefonoCliente}).`);
  } catch (error) {
    console.error(`[chat-web] No se pudo avisar el interesado (${asistente?.titulo}, ${telefonoCliente}):`, error.message);
  }
}

module.exports = { avisarInteresadoWeb };
