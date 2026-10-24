// Fase 2 del panel Clientes Web (2026-10-23): cuando el bot de Multidigital termina
// el guion de atención y deriva la conversación a una persona, el interesado entra
// solo al panel como "Interesado" (origen BOT), con los datos que dio en el chat.
// Se llama sin await desde chatbotEngine (no demora la respuesta de WhatsApp) y
// nunca lanza: si algo falla, solo queda en el log.

const prisma = require('./prisma');
const { extraerDatosLeadWeb } = require('../services/claude');

// Empresa cuyos interesados alimentan el panel (Multidigital, la del WhatsApp de anuncios).
const EMPRESA_ID_CLIENTES_WEB = process.env.EMPRESA_ID_CLIENTES_WEB || 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

function correspondeRegistrarLead(empresa) {
  return !!empresa?.guionAtencion && empresa.id === EMPRESA_ID_CLIENTES_WEB;
}

function limpio(valor) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  return v || null;
}

/**
 * @param {Object} p
 * @param {Object} p.empresa
 * @param {string} p.telefono - teléfono de WhatsApp (o id de Instagram/Facebook según canal)
 * @param {string} p.canal
 * @param {Array} p.mensajes - historial completo de la conversación [{rol, contenido}]
 */
async function registrarLeadDesdeBot({ empresa, telefono, canal, mensajes }) {
  try {
    if (!correspondeRegistrarLead(empresa)) return;
    const datos = await extraerDatosLeadWeb(mensajes);
    const telefonoWhatsApp = canal === 'whatsapp' ? String(telefono).replace(/\D/g, '') : null;
    const preferencia = ['EJEMPLO', 'LLAMADA'].includes(datos.preferencia) ? datos.preferencia : null;
    const notaCanal = canal !== 'whatsapp' ? `Llegó por ${canal} (id ${telefono}).` : null;
    const campos = {
      negocio: limpio(datos.negocio),
      rubro: limpio(datos.rubro),
      contactoNombre: limpio(datos.contactoNombre),
      comuna: limpio(datos.comuna),
      preferencia,
      horarioLlamada: limpio(datos.horarioLlamada),
    };

    // Misma persona con una ficha abierta: se completan los datos que falten, sin duplicar.
    // WhatsApp se reconoce por teléfono; Instagram/Facebook, por el id del canal en las notas.
    const existente = await prisma.clienteWeb.findFirst({
      where: {
        etapa: { not: 'BAJA' },
        ...(telefonoWhatsApp ? { telefono: telefonoWhatsApp } : { notas: { contains: `(id ${telefono})` } }),
      },
      orderBy: { creadoEn: 'desc' },
    });
    if (existente) {
      const faltantes = {};
      for (const [k, v] of Object.entries(campos)) if (v && !existente[k]) faltantes[k] = v;
      // Una ficha "sin nombre" del bot recibe el negocio real si ahora lo dio.
      if (campos.negocio && existente.origen === 'BOT' && /^Interesado /.test(existente.negocio)) faltantes.negocio = campos.negocio;
      if (Object.keys(faltantes).length) {
        await prisma.clienteWeb.update({ where: { id: existente.id }, data: faltantes });
      }
      console.log(`[lead-cliente-web] Ficha existente actualizada desde el bot: ${existente.id}`);
      return;
    }

    const nuevo = await prisma.clienteWeb.create({
      data: {
        ...campos,
        negocio: campos.negocio || (telefonoWhatsApp ? `Interesado +${telefonoWhatsApp}` : `Interesado (${canal})`),
        telefono: telefonoWhatsApp,
        etapa: 'INTERESADO',
        origen: 'BOT',
        notas: notaCanal,
      },
    });
    console.log(`[lead-cliente-web] Interesado creado desde el bot: ${nuevo.id}`);
  } catch (error) {
    console.error('[lead-cliente-web] No se pudo registrar el interesado:', error.message);
  }
}

module.exports = { registrarLeadDesdeBot, correspondeRegistrarLead, EMPRESA_ID_CLIENTES_WEB };
