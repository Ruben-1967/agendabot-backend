// src/jobs/pausaCoexistence.js
//
// Ciclo de vida de la pausa del bot en Coexistence (ver detección del echo
// en server.js y el chequeo de pausa en chatbotEngine.js). Para cada
// Conversacion con pausadaPorHumanoEn no nulo:
//
//   1. A los 5 min desde pausadaPorHumanoEn, si no se mandó antes: un único
//      mensaje de contención al cliente.
//   2. A los empresa.minutosAlertaUrgente minutos desde pausadaPorHumanoEn
//      (configurable por negocio en Información del negocio, 10 por
//      defecto), si no se mandó antes: una única alerta interna al negocio
//      por WhatsApp (a empresa.telefonoContacto, plantilla aprobada — ver
//      enviarAlertaUrgenteInterna más abajo). El panel además muestra un
//      aviso mientras pausadaPorHumanoEn siga sin null — ver GET
//      /conversaciones/:empresaId/pendientes/count.
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
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { descifrarSiCorresponde } = require('../lib/cifrado');
const { obtenerUrlPanelPrincipal } = require('../lib/urlPanel');

const MINUTOS_CONTENCION = 5;
const MINUTOS_ALERTA_DEFECTO = 10; // fallback si la empresa no tiene minutosAlertaUrgente seteado
const HORAS_REACTIVACION = 2;

const TEXTO_CONTENCION = 'Estamos revisando tu consulta, en breve te respondemos 🙌';

// Igual que los avisos de prueba vencida / activación de cuenta
// (bloquearEmpresasVencidas.js, auth.js): mensajes del PLATAFORMA hacia el
// negocio usan el número propio de AgendaBot (DEMO_PHONE_NUMBER_ID), no el
// número conectado del negocio — y van a empresa.telefonoContacto. Como esa
// conversación casi seguro lleva más de 24h sin actividad, tiene que ser
// una plantilla aprobada por Meta, no texto libre.
const TEMPLATE_ALERTA_URGENTE = 'alerta_cliente_pide_humano'; // debe existir y estar aprobada en Meta

async function enviarAlertaUrgenteInterna(conversacion, empresa) {
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken || !empresa.telefonoContacto) {
    console.warn(
      `[PAUSA-COEXISTENCE] ALERTA URGENTE (sin poder enviar — falta telefonoContacto o config de plataforma): ` +
      `conversación ${conversacion.id} de "${empresa.nombre}" (cliente ${conversacion.telefono}) lleva ` +
      `${MINUTOS_ALERTA}+ min sin resolución tras intervención humana.`
    );
    return;
  }

  try {
    await sendWhatsAppTemplateMessage({
      phoneNumberId,
      accessToken,
      to: empresa.telefonoContacto,
      templateName: TEMPLATE_ALERTA_URGENTE,
      variables: [empresa.nombre, conversacion.telefono, `${obtenerUrlPanelPrincipal()}/admin/chats`],
    });
  } catch (error) {
    console.error(`[PAUSA-COEXISTENCE] Error enviando alerta urgente por WhatsApp a "${empresa.nombre}":`, error.message);
  }
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
        // whatsappToken llega anidado (Conversacion -> Empresa), la
        // extensión de Prisma no lo descifra automáticamente ahí.
        const accessToken = descifrarSiCorresponde(empresa.whatsappToken) || process.env.WHATSAPP_ACCESS_TOKEN;
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

      // 3. Alerta interna — el umbral lo decide cada negocio (decisión
      // 2026-09-04, antes era un fijo global de 10 min para todos).
      const minutosAlerta = empresa.minutosAlertaUrgente ?? MINUTOS_ALERTA_DEFECTO;
      if (minutosDesdePausa >= minutosAlerta && !conversacion.alertaUrgenteEnviadaEn) {
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
