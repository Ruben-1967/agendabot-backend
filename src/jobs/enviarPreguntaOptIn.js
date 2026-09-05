// src/jobs/enviarPreguntaOptIn.js
//
// Envía la pregunta de opt-in de campañas (botones Sí/No) a clientes que
// llevan silencio desde su último mensaje y todavía no han sido preguntados
// nunca. Aplica por igual a empresas de AGENDAMIENTO y CATALOGO_ROTATIVO —
// no se filtra por rubro.
//
// La idea es preguntar al FINAL de la conversación, no interrumpir una en
// curso — 30s (el valor original) resultó demasiado agresivo: cualquier
// pausa normal del cliente pensando su respuesta ya alcanzaba a disparar la
// pregunta a mitad de una conversación real (reportado por Ahorróptica,
// 2026-09-02, justo después de un simple "Hola"). SEGUNDOS_ESPERA ahora es
// bastante más largo para dar tiempo real antes de asumir que terminó.
//
// A diferencia de confirmarCitasProximas.js (que corre como un Render Cron
// Job separado), este job usa node-cron autoprogramado DENTRO del mismo
// proceso del backend web — no requiere crear un servicio de Render nuevo.
// Se activa una sola vez, al hacer require() de este archivo desde server.js.

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppReplyButtons } = require('../services/whatsapp');
const { descifrarSiCorresponde } = require('../lib/cifrado');

const MINUTOS_ESPERA_DEFECTO = 10; // fallback si la empresa no tiene minutosEsperaOptIn seteado
const TEXTO_PREGUNTA = '¿Quieres que te avisemos por acá de promociones y novedades?';

async function enviarPreguntasOptInPendientes() {
  // Candidatos: cualquier Cliente de una empresa real (no demo), con
  // WhatsApp conectado, que nunca haya sido preguntado — y solo de negocios
  // que eligieron usar marketing (ver Empresa.usaOptInMarketing, decisión
  // 2026-09-05 sobre Ley 21.719). El que se comprometió a "solo
  // agendamiento" nunca debería mandar esta pregunta — no tiene sentido
  // pedir opt-in para algo que el negocio prometió no hacer.
  const clientesCandidatos = await prisma.cliente.findMany({
    where: {
      optInCampanasPreguntado: false,
      telefono: { not: null },
      empresa: { esDemo: false, whatsappNumeroId: { not: null }, usaOptInMarketing: true },
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
      const minutosEspera = cliente.empresa.minutosEsperaOptIn ?? MINUTOS_ESPERA_DEFECTO;
      const limiteEspera = new Date(Date.now() - minutosEspera * 60 * 1000);
      if (timestampUltimo > limiteEspera) continue; // todavía no pasó el silencio configurado

      // whatsappToken llega anidado (Cliente -> Empresa), la extensión de
      // Prisma no lo descifra automáticamente ahí — ver descifrarSiCorresponde.
      const accessToken = descifrarSiCorresponde(cliente.empresa.whatsappToken) || process.env.WHATSAPP_ACCESS_TOKEN;
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

// Cada 5 minutos — suficiente granularidad para un umbral de silencio de
// 10 minutos sin agregar demasiado retraso extra por el propio ciclo del
// cron (comentario desactualizado corregido: antes decía "cada 20
// segundos", pero el cron ya corría cada 5 minutos desde antes de esto).
cron.schedule('*/5 * * * *', () => {
  enviarPreguntasOptInPendientes().catch((error) => {
    console.error('[OPT-IN] Error en el ciclo del job de opt-in:', error);
  });
});

console.log('[OPT-IN] Job de preguntas de opt-in programado (cada 5 minutos).');

module.exports = { enviarPreguntasOptInPendientes };