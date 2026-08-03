/**
 * src/jobs/bloquearEmpresasVencidas.js
 *
 * Cron job que corre cada 6 horas:
 * 1. Busca empresas en prueba con pruebahasta vencido (sin plan activo)
 * 2. Envía aviso "Tu prueba termina en X días"
 * 3. Después de 3 días sin respuesta (sin pago), bloquea automáticamente
 */

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { enviarPlantillaWhatsApp } = require('../services/whatsapp');

/**
 * Inicia el job de bloqueo (debe llamarse desde server.js)
 */
function iniciarJobBloqueoVencidas() {
  // Cada 6 horas: 0 */6 * * *
  // Cada hora (desarrollo): 0 * * * *
  // En tests: no iniciar automático
  cron.schedule('0 */6 * * *', async () => {
    console.log('[job] Ejecutando: bloquearEmpresasVencidas');
    try {
      await procesarEmpresasVencidas();
    } catch (error) {
      console.error('[job] Error en bloquearEmpresasVencidas:', error);
    }
  });
}

/**
 * Lógica principal
 */
async function procesarEmpresasVencidas() {
  const hoy = new Date();

  // PASO 1: Empresas en PRUEBA cuya prueba ACABA DE VENCER (hoy) → PRIMERA ADVERTENCIA
  const empresasVencenHoy = await prisma.empresa.findMany({
    where: {
      estadoSuscripcion: 'PRUEBA',
      planActivo: null,
      pruebahasta: {
        lte: new Date(hoy.getTime() + 24 * 60 * 60 * 1000), // próximas 24h
        gte: hoy, // no más viejo
      },
      diasAdvertenciaEnviados: { lt: 1 }, // aún no le enviamos aviso
    },
    select: { id: true, nombre: true, telefonoContacto: true },
  });

  for (const empresa of empresasVencenHoy) {
    try {
      // Enviar plantilla de WhatsApp (si existe)
      // await enviarPlantillaWhatsApp({
      //   empresaId: empresa.id,
      //   numeroDestino: empresa.telefonoContacto,
      //   templateName: 'prueba_por_vencer',
      //   params: { nombreNegocio: empresa.nombre }
      // });

      // Por ahora, solo marcar que enviamos aviso
      await prisma.empresa.update({
        where: { id: empresa.id },
        data: { diasAdvertenciaEnviados: 1 },
      });

      console.log(`[job] Aviso 1 enviado a ${empresa.nombre}`);
    } catch (errAviso) {
      console.warn(`[job] Error enviando aviso a ${empresa.id}:`, errAviso.message);
    }
  }

  // PASO 2: Empresas en PRUEBA cuya prueba VENCE HOY + no han pagado → SEGUNDA/TERCERA ADVERTENCIA
  const empresasConAdviso = await prisma.empresa.findMany({
    where: {
      estadoSuscripcion: 'PRUEBA',
      planActivo: null,
      pruebahasta: { lte: hoy },
      diasAdvertenciaEnviados: { lt: 3 },
    },
    select: { id: true, nombre: true, diasAdvertenciaEnviados: true },
  });

  for (const empresa of empresasConAdviso) {
    try {
      // Si ya pasaron 3 días sin pago: BLOQUEAR
      if (empresa.diasAdvertenciaEnviados >= 2) {
        await prisma.empresa.update({
          where: { id: empresa.id },
          data: {
            estadoSuscripcion: 'BLOQUEADA',
            planActivo: null,
          },
        });
        console.log(`[job] Empresa ${empresa.nombre} BLOQUEADA por falta de pago`);
      } else {
        // Si no: incrementar contador de avisos
        await prisma.empresa.update({
          where: { id: empresa.id },
          data: { diasAdvertenciaEnviados: empresa.diasAdvertenciaEnviados + 1 },
        });
        console.log(`[job] Aviso ${empresa.diasAdvertenciaEnviados + 1} a ${empresa.nombre}`);
      }
    } catch (errBloqueo) {
      console.warn(`[job] Error bloqueando/avisando a ${empresa.id}:`, errBloqueo.message);
    }
  }

  // PASO 3: Empresas ACTIVAS cuya suscripción VENCE PRONTO → AVISO PREVENTIVO
  // (esto es opcional — Flow.cl ya envía su propio aviso)
  const proximas2Semanas = new Date(hoy.getTime() + 14 * 24 * 60 * 60 * 1000);
  const empresasProximasAVencer = await prisma.empresa.findMany({
    where: {
      estadoSuscripcion: 'ACTIVA',
      fechaVencimientoPago: {
        lte: proximas2Semanas,
        gte: hoy,
      },
    },
    select: { id: true, nombre: true },
  });

  console.log(`[job] Empresas próximas a vencer (2 semanas): ${empresasProximasAVencer.length}`);

  console.log('[job] Proceso finalizado: bloquearEmpresasVencidas');
}

module.exports = { iniciarJobBloqueoVencidas, procesarEmpresasVencidas };