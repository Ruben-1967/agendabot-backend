/**
 * src/jobs/bloquearEmpresasVencidas.js
 *
 * Cron job que corre cada 6 horas:
 * 1. Busca empresas (no demo) con la prueba vencida y sin una Suscripcion
 *    pagada (sin Suscripcion, o con una en PENDIENTE_PAGO — eligieron plan
 *    pero no completaron el pago en Flow).
 * 2. Les manda hasta MAX_AVISOS recordatorios por WhatsApp (plantilla,
 *    porque a esta altura ya está fuera de la ventana de 24h), espaciados
 *    DIAS_ENTRE_AVISOS días, con el link para suscribirse.
 * 3. Agotados los avisos + un último plazo de gracia, marca la empresa como
 *    bloqueadaPorPruebaVencida=true. Esa marca por sí sola NO corta nada —
 *    el corte real del chat (en server.js) solo ocurre si la variable de
 *    entorno BLOQUEO_PRUEBA_VENCIDA_ACTIVO='true' está prendida. Por defecto
 *    queda apagado: este job solo deja la empresa "lista para bloquear" y
 *    sigue avisando por WhatsApp.
 *
 * Umbrales — PENDIENTE DE CONFIRMAR con Ruben antes de ajustar en serio,
 * dejados como constantes para poder tunearlos sin tocar la lógica.
 */

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { obtenerUrlPanelPrincipal } = require('../lib/urlPanel');

const MAX_AVISOS = 3;
const DIAS_ENTRE_AVISOS = 3; // también se usa como plazo de gracia después del último aviso, antes de marcar bloqueadaPorPruebaVencida
const TEMPLATE_PRUEBA_VENCIDA = 'agendabot_prueba_vencida_v3'; // ver scripts/crear-plantilla-prueba-vencida.js — hay que enviarla a revisión antes de que esto funcione de verdad

function diasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60 * 24);
}

/**
 * Inicia el job (debe llamarse desde server.js)
 */
function iniciarJobBloqueoVencidas() {
  cron.schedule('0 */6 * * *', async () => {
    console.log('[job] Ejecutando: bloquearEmpresasVencidas');
    try {
      await procesarEmpresasVencidas();
    } catch (error) {
      console.error('[job] Error en bloquearEmpresasVencidas:', error);
    }
  });
}

async function enviarAvisoPruebaVencida(empresa) {
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('Faltan DEMO_PHONE_NUMBER_ID o DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
  }
  if (!empresa.telefonoContacto) {
    throw new Error('La empresa no tiene telefonoContacto.');
  }

  const link = `${obtenerUrlPanelPrincipal()}/suscripcion/elegir-plan?empresaId=${empresa.id}`;

  await sendWhatsAppTemplateMessage({
    phoneNumberId,
    to: empresa.telefonoContacto,
    accessToken,
    templateName: TEMPLATE_PRUEBA_VENCIDA,
    variables: [empresa.nombre, link],
  });
}

/**
 * Lógica principal
 */
async function procesarEmpresasVencidas() {
  const hoy = new Date();

  const empresasVencidas = await prisma.empresa.findMany({
    where: {
      esDemo: false,
      pruebahasta: { not: null, lte: hoy },
      bloqueadaPorPruebaVencida: false,
      OR: [
        { suscripcion: null },
        { suscripcion: { estado: 'PENDIENTE_PAGO' } },
      ],
    },
    select: {
      id: true,
      nombre: true,
      telefonoContacto: true,
      avisosPruebaVencidaEnviados: true,
      fechaUltimoAvisoPrueba: true,
    },
  });

  let avisosEnviados = 0;
  let empresasBloqueadas = 0;

  for (const empresa of empresasVencidas) {
    try {
      const yaTocaProximoPaso = !empresa.fechaUltimoAvisoPrueba
        || diasEntre(hoy, empresa.fechaUltimoAvisoPrueba) >= DIAS_ENTRE_AVISOS;

      if (!yaTocaProximoPaso) {
        continue; // todavía no pasó el plazo desde el último aviso
      }

      if (empresa.avisosPruebaVencidaEnviados < MAX_AVISOS) {
        await enviarAvisoPruebaVencida(empresa);
        await prisma.empresa.update({
          where: { id: empresa.id },
          data: {
            avisosPruebaVencidaEnviados: empresa.avisosPruebaVencidaEnviados + 1,
            fechaUltimoAvisoPrueba: hoy,
          },
        });
        avisosEnviados++;
        console.log(`[job] Aviso ${empresa.avisosPruebaVencidaEnviados + 1}/${MAX_AVISOS} enviado a ${empresa.nombre}`);
      } else {
        // Ya se mandaron los MAX_AVISOS y pasó el plazo de gracia desde el
        // último — queda lista para bloquear (el corte real depende del
        // toggle BLOQUEO_PRUEBA_VENCIDA_ACTIVO, ver server.js).
        await prisma.empresa.update({
          where: { id: empresa.id },
          data: { bloqueadaPorPruebaVencida: true, fechaBloqueoPrueba: hoy },
        });
        empresasBloqueadas++;
        console.log(`[job] Empresa ${empresa.nombre} marcada bloqueadaPorPruebaVencida (agotó los ${MAX_AVISOS} avisos)`);
      }
    } catch (errEmpresa) {
      console.warn(`[job] Error procesando empresa ${empresa.id} (${empresa.nombre}):`, errEmpresa.message);
    }
  }

  console.log(`[job] Proceso finalizado: ${avisosEnviados} avisos enviados, ${empresasBloqueadas} empresas marcadas para bloqueo (de ${empresasVencidas.length} revisadas).`);
}

module.exports = { iniciarJobBloqueoVencidas, procesarEmpresasVencidas };
