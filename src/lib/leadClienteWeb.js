// Fase 2 del panel Clientes Web (2026-10-23): cuando el bot de Multidigital termina
// el guion de atención y deriva la conversación a una persona, el interesado entra
// solo al panel como "Interesado" (origen BOT), con los datos que dio en el chat.
// Se llama sin await desde chatbotEngine (no demora la respuesta de WhatsApp) y
// nunca lanza: si algo falla, solo queda en el log.

const prisma = require('./prisma');
const { extraerDatosLeadWeb } = require('../services/claude');
const { esIdUsuarioWhatsApp } = require('../services/whatsapp');
const { buscarOrigenAnuncio } = require('./origenAnuncio');

// Empresa cuyos interesados alimentan el panel (Multidigital, la del WhatsApp de anuncios).
const EMPRESA_ID_CLIENTES_WEB = process.env.EMPRESA_ID_CLIENTES_WEB || 'b087c530-5f89-4ecd-8cfb-9fda7069a426';

function correspondeRegistrarLead(empresa) {
  return !!empresa?.guionAtencion && empresa.id === EMPRESA_ID_CLIENTES_WEB;
}

function limpio(valor) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  return v || null;
}

// Chat del sitio web: el número lo escribe la persona ("+56 9 1234 5678", "912345678").
// Solo dígitos, con el 56 de Chile si dio un celular chileno de 9 dígitos; si no parece
// un teléfono, null (mejor una ficha sin teléfono que uno inventado).
function telefonoDado(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) return `56${d}`;
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
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
    // Con nombre de usuario de WhatsApp no hay teléfono: se guarda su id (BSUID) tal cual.
    // En el chat del sitio web no hay número de canal: se usa el que la persona escribió.
    const telefonoWhatsApp = canal === 'web' ? telefonoDado(datos.telefono)
      : canal !== 'whatsapp' ? null
        : esIdUsuarioWhatsApp(telefono) ? String(telefono) : String(telefono).replace(/\D/g, '');
    const preferencia = ['EJEMPLO', 'LLAMADA'].includes(datos.preferencia) ? datos.preferencia : null;
    const notaCanal = canal === 'web'
      ? `Llegó por el chat del sitio web (id ${telefono}).${limpio(datos.telefono) ? ` Número que escribió: "${limpio(datos.telefono)}".` : ''}`
      : canal !== 'whatsapp' ? `Llegó por ${canal} (id ${telefono}).` : null;
    // Anuncio desde el que escribió (solo WhatsApp: Meta lo manda en el primer mensaje).
    const origen = canal === 'whatsapp'
      ? await buscarOrigenAnuncio({ phoneNumberId: empresa.whatsappNumeroId, telefono })
      : null;
    const campos = {
      negocio: limpio(datos.negocio),
      rubro: limpio(datos.rubro),
      contactoNombre: limpio(datos.contactoNombre),
      comuna: limpio(datos.comuna),
      preferencia,
      horarioLlamada: limpio(datos.horarioLlamada),
      anuncioOrigen: origen ? {
        sourceId: origen.sourceId, sourceType: origen.sourceType, sourceUrl: origen.sourceUrl,
        titulo: origen.titulo, texto: origen.texto, fecha: origen.creadoEn,
      } : null,
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
      // Desde el chat web cualquiera puede escribir un número: se deja constancia en la
      // ficha para que el equipo sepa de dónde vinieron los datos.
      if (canal === 'web' && notaCanal && !(existente.notas || '').includes(`(id ${telefono})`)) {
        faltantes.notas = [existente.notas, notaCanal].filter(Boolean).join('\n');
      }
      if (Object.keys(faltantes).length) {
        await prisma.clienteWeb.update({ where: { id: existente.id }, data: faltantes });
      }
      console.log(`[lead-cliente-web] Ficha existente actualizada desde el bot: ${existente.id}`);
      return;
    }

    const nuevo = await prisma.clienteWeb.create({
      data: {
        ...campos,
        negocio: campos.negocio || (telefonoWhatsApp ? `Interesado ${esIdUsuarioWhatsApp(telefonoWhatsApp) ? '' : '+'}${telefonoWhatsApp}` : `Interesado (${canal})`),
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

module.exports = { registrarLeadDesdeBot, correspondeRegistrarLead, EMPRESA_ID_CLIENTES_WEB, _interno: { telefonoDado } };
