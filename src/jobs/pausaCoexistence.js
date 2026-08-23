// src/jobs/pausaCoexistence.js
//
// Ciclo de vida de la pausa del bot en Coexistence (ver detección del echo
// en server.js y el chequeo de pausa en chatbotEngine.js). Para cada
// Conversacion con pausadaPorHumanoEn no nulo:
//
//   1. A los 5 min desde pausadaPorHumanoEn, si no se mandó antes: un único
//      mensaje de contención al cliente.
//   2. A los 10 min desde pausadaPorHumanoEn, si no se mandó antes: una
//      única alerta interna al negocio (hoy solo un log — ver
//      enviarAlertaUrgenteInterna más abajo).
//   3. A las 2h desde el ÚLTIMO mensaje del CLIENTE (no desde
//      pausadaPorHumanoEn — ver diseño aprobado, no hay tope de reactivación
//      por tiempo desde la intervención humana): se reactiva el bot,
//      limpiando los 3 campos para que una futura intervención repita el
//      ciclo completo desde cero.
//
// Mismo patrón que enviarPreguntaOptIn.js: node-cron autoprogramado dentro
// del proceso web, sin necesidad de un servicio de Render Cron aparte.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppTextMessage } = require('../services/whatsapp');

const MINUTOS_CONTENCION = 5;
const MINUTOS_ALERTA = 10;
const HORAS_REACTIVACION = 2;

const TEXTO_CONTENCION = 'Estamos revisando tu consulta, en breve te respondemos 🙌';

// TODO: no existe todavía un mecanismo de alerta interna al negocio en el
// código (el pendiente "alerta cuando el cliente pide hablar con un
// humano" — ver memoria del proyecto — sigue sin implementarse). Cuando se
// construya, compartir esa misma infraestructura acá en vez de duplicarla.
// Por ahora, solo queda logueado — nadie recibe un aviso real todavía.
async function enviarAlertaUrgenteInterna(conversacion, empresa) {
  console.warn(
    `[PAUSA-COEXISTENCE] ALERTA URGENTE (sin canal real todavía): conversación ${conversacion.id} ` +
    `de "${empresa.nombre}" (cliente ${conversacion.telefono}) lleva ${MINUTOS_ALERTA}+ min sin ` +
    `resolución tras intervención humana.`
  );
}

function obtenerTimestampUltimoMensajeCliente(mensajes) {
  const lista = Array.isArray(mensajes) ? mensajes : [];
  const mensajesDelCliente = lista.filter((m) => m.rol === 'usuario');
  if (mensajesDelCliente.length === 0) return null;
  return new Date(mensajesDelCliente[mensajesDelCliente.length - 1].timestamp);
}

async function procesarPausasCoexistence() {
  const ahora = Date.now();

  const conversacionesPausadas = await prisma.conversacion.findMany({
    where: {
      pausadaPorHumanoEn: { not: null },
      empresa: { esDemo: false },
    },
    include: { empresa: true },
  });

  for (const conversacion of conversacionesPausadas) {
    try {
      const { empresa } = conversacion;
      const minutosDesdePausa = (ahora - conversacion.pausadaPorHumanoEn.getTime()) / 60000;

      // 1. Reactivación por silencio del cliente — se revisa primero: si ya
      // se cumplió, no tiene sentido evaluar contención/alerta esta vuelta.
      const timestampUltimoMensajeCliente = obtenerTimestampUltimoMensajeCliente(conversacion.mensajes);
      if (timestampUltimoMensajeCliente) {
        const horasDesdeUltimoMensajeCliente = (ahora - timestampUltimoMensajeCliente.getTime()) / 3600000;
        if (horasDesdeUltimoMensajeCliente >= HORAS_REACTIVACION) {
          await prisma.conversacion.update({
            where: { id: conversacion.id },
            data: { pausadaPorHumanoEn: null, contencionEnviadaEn: null, alertaUrgenteEnviadaEn: null },
          });
          console.log(`[PAUSA-COEXISTENCE] Bot reactivado para ${conversacion.telefono} (${empresa.nombre}) tras ${HORAS_REACTIVACION}h de silencio del cliente.`);
          continue;
        }
      }
      // Si nunca hubo mensaje del cliente (humano escribió primero y el
      // cliente todavía no responde), no hay silencio del cliente que medir
      // — queda pausada indefinidamente hasta que el cliente escriba.

      // 2. Mensaje de contención a los 5 min.
      if (minutosDesdePausa >= MINUTOS_CONTENCION && !conversacion.contencionEnviadaEn) {
        const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
        if (accessToken && empresa.whatsappNumeroId) {
          await sendWhatsAppTextMessage({
            phoneNumberId: empresa.whatsappNumeroId,
            to: conversacion.telefono,
            accessToken,
            text: TEXTO_CONTENCION,
          });

          const mensajesActualizados = [
            ...(Array.isArray(conversacion.mensajes) ? conversacion.mensajes : []),
            { rol: 'asistente', contenido: TEXTO_CONTENCION, timestamp: new Date().toISOString() },
          ];

          await prisma.conversacion.update({
            where: { id: conversacion.id },
            data: { mensajes: mensajesActualizados, contencionEnviadaEn: new Date() },
          });

          console.log(`[PAUSA-COEXISTENCE] Contención enviada a ${conversacion.telefono} (${empresa.nombre}).`);
        }
      }

      // 3. Alerta interna a los 10 min.
      if (minutosDesdePausa >= MINUTOS_ALERTA && !conversacion.alertaUrgenteEnviadaEn) {
        await enviarAlertaUrgenteInterna(conversacion, empresa);
        await prisma.conversacion.update({
          where: { id: conversacion.id },
          data: { alertaUrgenteEnviadaEn: new Date() },
        });
      }
    } catch (error) {
      console.error(`[PAUSA-COEXISTENCE] Error procesando conversación ${conversacion.id}:`, error);
    }
  }
}

// Cada 1 minuto — hay ventanas de 5 y 10 minutos que respetar con cierta
// precisión, a diferencia de otros jobs de este archivo con umbrales más
// laxos.
cron.schedule('*/1 * * * *', () => {
  procesarPausasCoexistence().catch((error) => {
    console.error('[PAUSA-COEXISTENCE] Error en el ciclo del job:', error);
  });
});

console.log('[PAUSA-COEXISTENCE] Job de pausa por Coexistence programado (cada 1 minuto).');

module.exports = { procesarPausasCoexistence };
