// Bot silenciado para un contacto (2026-10-24). A diferencia de la pausa de Coexistence
// (Conversacion.pausadaPorHumanoEn, que se reactiva sola tras 2h de silencio del
// cliente), esto es permanente hasta que alguien lo cambie. Dos fuentes:
//
//   1. Manual: Conversacion.botSilenciadoEn, botón en Chats en vivo (cualquier negocio).
//   2. Automática, solo Multidigital: el teléfono es un prospecto de Clientes Web que ya
//      avanzó más allá de "Interesado" (Rubén ya está negociando con él). Si vuelve a
//      INTERESADO o pasa a BAJA, el bot lo atiende de nuevo.
//
// Silenciado = el motor guarda el mensaje del cliente en el historial y no responde
// nada (igual que la pausa), y el job de pausa no le manda contención ni alertas.

const prisma = require('./prisma');
const { EMPRESA_ID_CLIENTES_WEB } = require('./leadClienteWeb');

const ETAPAS_CLIENTE_WEB_QUE_SILENCIAN = ['EJEMPLO_ENVIADO', 'EN_ESPERA', 'ABONO', 'ACTIVO'];

/**
 * Motivo por el que el bot no debe responder a este contacto, o null si puede.
 * @param {Object} p
 * @param {string} p.empresaId
 * @param {string} p.telefono - teléfono de WhatsApp (o IGSID en Instagram/Facebook)
 * @param {string} [p.canal]
 * @param {Object|null} [p.conversacion] - con botSilenciadoEn, si ya se tiene a mano
 * @returns {Promise<'MANUAL'|'CLIENTE_WEB'|null>}
 */
async function motivoBotSilenciado({ empresaId, telefono, canal = 'whatsapp', conversacion = null }) {
  if (conversacion?.botSilenciadoEn) return 'MANUAL';
  if (empresaId !== EMPRESA_ID_CLIENTES_WEB || canal !== 'whatsapp' || !telefono) return null;
  const clienteWeb = await prisma.clienteWeb.findFirst({
    where: { telefono: String(telefono).replace(/\D/g, ''), etapa: { in: ETAPAS_CLIENTE_WEB_QUE_SILENCIAN } },
    select: { id: true },
  });
  return clienteWeb ? 'CLIENTE_WEB' : null;
}

module.exports = { motivoBotSilenciado, ETAPAS_CLIENTE_WEB_QUE_SILENCIAN };
