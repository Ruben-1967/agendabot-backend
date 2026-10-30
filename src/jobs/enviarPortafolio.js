// src/jobs/enviarPortafolio.js
//
// Portafolio a quien deja la conversación sin dar sus datos (2026-10-30, pedido
// de Rubén). Solo para el WhatsApp de Multidigital (EMPRESA_ID_CLIENTES_WEB): si
// la persona dejó de responder hace 3+ horas, pero sigue dentro de la ventana de
// 24 h de WhatsApp, y el bot no alcanzó a cerrar el guion (no hay ficha en
// Clientes Web con ese teléfono), se le manda UNA vez el link del portafolio.
//
// No se envía si:
//   - el último mensaje es del cliente (le toca responder al bot o a Rubén);
//   - Rubén ya escribió a mano en esa conversación (mensaje 'admin' o pausa
//     por Coexistence) o el bot está silenciado para ese contacto;
//   - la conversación ya tiene el link (el marcador es el propio mensaje);
//   - es fuera de lunes a sábado 08:00–20:00 de Chile (src/lib/horaChile.js).
//
// Mismo patrón que pausaCoexistence.js: node-cron dentro del proceso web.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { motivoBotSilenciado } = require('../lib/botSilenciado');
const { sendWhatsAppTextMessage, esIdUsuarioWhatsApp } = require('../services/whatsapp');
const { descifrarSiCorresponde } = require('../lib/cifrado');
const { estaEnHorarioHabilChile } = require('../lib/horaChile');
const { EMPRESA_ID_CLIENTES_WEB } = require('../lib/leadClienteWeb');

const URL_PORTAFOLIO = 'https://muestras.multidigital.cl/portafolio.html';
const HORAS_SILENCIO_MIN = 3;
const HORAS_SILENCIO_MAX = 23; // margen bajo las 24 h de la ventana de servicio

const TEXTO_PORTAFOLIO =
  `¡Hola! Por si te sirve para decidir, acá puedes ver algunos sitios web que hemos hecho: ${URL_PORTAFOLIO}\n` +
  'Si te interesa, cuéntanos a qué se dedica tu negocio y cómo se llama, y te preparamos un ejemplo gratis 🙌';

// Decide con los datos de la conversación, sin tocar la BD ni WhatsApp (se prueba aparte).
function correspondeEnviarPortafolio(conversacion, ahora = new Date()) {
  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  if (mensajes.length === 0) return false;
  if (conversacion.escaladoAHumano || conversacion.pausadaPorHumanoEn || conversacion.botSilenciadoEn) return false;
  if (mensajes.some((m) => m.rol === 'admin' || String(m.contenido || '').includes(URL_PORTAFOLIO))) return false;
  if (mensajes[mensajes.length - 1].rol !== 'asistente') return false;

  const delCliente = mensajes.filter((m) => m.rol === 'usuario');
  if (delCliente.length === 0) return false;
  const horas = (ahora.getTime() - new Date(delCliente[delCliente.length - 1].timestamp).getTime()) / 3600000;
  return horas >= HORAS_SILENCIO_MIN && horas < HORAS_SILENCIO_MAX;
}

async function enviarPortafolioPendientes(ahora = new Date()) {
  if (!estaEnHorarioHabilChile(ahora)) return;

  const conversaciones = await prisma.conversacion.findMany({
    where: {
      empresaId: EMPRESA_ID_CLIENTES_WEB,
      canal: 'whatsapp',
      escaladoAHumano: false,
      pausadaPorHumanoEn: null,
      botSilenciadoEn: null,
      actualizadoEn: { gte: new Date(ahora.getTime() - HORAS_SILENCIO_MAX * 3600000) },
    },
    include: { empresa: true },
  });

  for (const conversacion of conversaciones) {
    try {
      if (!correspondeEnviarPortafolio(conversacion, ahora)) continue;
      const { empresa, telefono } = conversacion;

      // Ya dejó sus datos por otro camino (ficha en Clientes Web): no corresponde.
      const telefonoFicha = esIdUsuarioWhatsApp(telefono) ? String(telefono) : String(telefono).replace(/\D/g, '');
      const ficha = await prisma.clienteWeb.findFirst({ where: { telefono: telefonoFicha }, select: { id: true } });
      if (ficha) continue;
      if (await motivoBotSilenciado({ empresaId: empresa.id, telefono, canal: 'whatsapp', conversacion })) continue;

      // whatsappToken llega anidado (Conversacion -> Empresa), la extensión de
      // Prisma no lo descifra automáticamente ahí.
      const accessToken = descifrarSiCorresponde(empresa.whatsappToken) || process.env.WHATSAPP_ACCESS_TOKEN;
      if (!accessToken || !empresa.whatsappNumeroId) continue;

      // Se marca antes de enviar: si el envío falla, no se reintenta en cada pasada
      // (un portafolio de más molesta más que uno de menos).
      const mensajesActualizados = [
        ...conversacion.mensajes,
        { rol: 'asistente', contenido: TEXTO_PORTAFOLIO, timestamp: new Date().toISOString() },
      ];
      await prisma.conversacion.update({ where: { id: conversacion.id }, data: { mensajes: mensajesActualizados } });
      await sendWhatsAppTextMessage({ phoneNumberId: empresa.whatsappNumeroId, to: telefono, accessToken, text: TEXTO_PORTAFOLIO });
      console.log(`[PORTAFOLIO] Enviado a ${telefono}.`);
    } catch (error) {
      console.error(`[PORTAFOLIO] Error con la conversación ${conversacion.id}:`, error.message);
    }
  }
}

// Cada 30 minutos: el umbral es de horas, no hace falta más precisión.
cron.schedule('*/30 * * * *', () => {
  enviarPortafolioPendientes().catch((error) => {
    console.error('[PORTAFOLIO] Error en el ciclo del job:', error);
  });
});

console.log('[PORTAFOLIO] Job de envío del portafolio programado (cada 30 minutos).');

module.exports = { enviarPortafolioPendientes, correspondeEnviarPortafolio, TEXTO_PORTAFOLIO };
