// src/jobs/enviarPreguntaOptIn.js
//
// Envía la pregunta de opt-in de campañas (botones Sí/No) a clientes que
// llevan ~3 minutos de silencio desde su último mensaje y todavía no han
// sido preguntados nunca. Aplica por igual a empresas de AGENDAMIENTO y
// CATALOGO_ROTATIVO — no se filtra por rubro.
//
// A diferencia de confirmarCitasProximas.js (que corre como un Render Cron
// Job separado), este job usa node-cron autoprogramado DENTRO del mismo
// proceso del backend web — no requiere crear un servicio de Render nuevo.
// Se activa una sola vez, al hacer require() de este archivo desde server.js.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppReplyButtons } = require('../services/whatsapp');

const MINUTOS_ESPERA = 3;
const TEXTO_PREGUNTA = '¿Quieres que te avisemos por acá de promociones y novedades?';

async function enviarPreguntasOptInPendientes() {
  const limiteEspera = new Date(Date.now() - MINUTOS_ESPERA * 60 * 1000);

  // Candidatos: cualquier Cliente de una empresa real (no demo), con
  // WhatsApp conectado, que nunca haya sido preguntado.
  const clientesCandidatos = await prisma.cliente.findMany({
    where: {
      optInCampanasPreguntado: false,
      telefono: { not: null },
      empresa: { esDemo: false, whatsappNumeroId: { not: null } },
    },
    include: { empresa: true },
  });

  let enviados = 0;

  for (const cliente of clientesCandidatos) {
    try {
      const conversacion = await prisma.conversacion.findFirst({
        where: { empresaId: cliente.empresaId, telefono: cliente.telefono },
      });

      const mensajes = Array.isArray(conversacion?.mensajes) ? conversacion.mensajes : [];
      if (mensajes.length === 0) continue;

      // Buscamos el ÚLTIMO mensaje que sea específicamente del cliente
      // (no el último del arreglo en general, que casi siempre es la
      // respuesta del bot al turno más reciente) y medimos el silencio
      // desde ahí — sin importar si ya le respondimos después.
      const mensajesDelCliente = mensajes.filter((m) => m.rol === 'usuario');
      if (mensajesDelCliente.length === 0) continue;

      const ultimoMensajeCliente = mensajesDelCliente[mensajesDelCliente.length - 1];
      const timestampUltimo = new Date(ultimoMensajeCliente.timestamp);
      if (timestampUltimo > limiteEspera) continue; // todavía no pasaron los 3 minutos de silencio

      const accessToken = cliente.empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
      if (!accessToken) continue;

      await sendWhatsAppReplyButtons({
        phoneNumberId: cliente.empresa.whatsappNumeroId,
        to: cliente.telefono,
        accessToken,
        textoCuerpo: TEXTO_PREGUNTA,
        botones: [
          { id: 'optin_si', titulo: 'Sí' },
          { id: 'optin_no', titulo: 'No' },
        ],
      });

      const mensajesActualizados = [
        ...mensajes,
        { rol: 'asistente', contenido: TEXTO_PREGUNTA, timestamp: new Date().toISOString() },
      ];

      await prisma.$transaction([
        prisma.conversacion.update({
          where: { id: conversacion.id },
          data: { mensajes: mensajesActualizados },
        }),
        prisma.cliente.update({
          where: { id: cliente.id },
          data: { optInCampanasPreguntado: true, optInPreguntaPendiente: true },
        }),
      ]);

      enviados++;
      console.log(`[OPT-IN] Pregunta enviada a ${cliente.telefono} (${cliente.empresa.nombre}).`);
    } catch (error) {
      console.error(`[OPT-IN] Error procesando cliente ${cliente.id}:`, error);
    }
  }

  if (enviados > 0) {
    console.log(`[OPT-IN] Ciclo terminado: ${enviados} pregunta(s) enviada(s) de ${clientesCandidatos.length} candidato(s) revisados.`);
  }
}

// Corre cada 2 minutos — suficiente granularidad para un objetivo de ~3 min de silencio.
cron.schedule('*/2 * * * *', () => {
  enviarPreguntasOptInPendientes().catch((error) => {
    console.error('[OPT-IN] Error en el ciclo del job de opt-in:', error);
  });
});

console.log('[OPT-IN] Job de preguntas de opt-in programado (cada 2 minutos).');

module.exports = { enviarPreguntasOptInPendientes };