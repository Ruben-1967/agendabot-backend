/**
 * src/jobs/impagos.js
 *
 * Aplica la política de impago (ver src/lib/impagos.js) una vez al día. Para cada
 * suscripción con impagoDesde: manda el aviso que corresponda por correo y, en la
 * fecha de corte, la pasa a PAUSADA_POR_IMPAGO. Solo avanza de etapa cuando el
 * correo salió de verdad: si falla, se reintenta al día siguiente y NUNCA se corta
 * sin haber avisado.
 *
 * Cada escritura es condicional (updateMany con el estado leído): si un pago entra
 * mientras el job trabaja y el webhook limpia el impago, el job no pisa ese
 * cambio ni corta a quien acaba de pagar.
 *
 * Apagado por defecto: solo corre si AVISOS_IMPAGO_ACTIVO='true'. El corte real
 * (bot + panel) además exige BLOQUEO_IMPAGO_ACTIVO='true' -- ver
 * src/lib/estadoServicio.js. Se pueden prender por separado.
 */

const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { ACCION, accionImpago, calcularCorteImpago, corteTrasAviso2 } = require('../lib/impagos');
const { enviarAvisoImpago } = require('../services/emailAvisosImpago');

async function procesarImpagos({ ahora = new Date(), dryRun = false } = {}) {
  const pendientes = await prisma.suscripcion.findMany({
    where: { impagoDesde: { not: null }, estado: { in: ['ACTIVA', 'PAUSADA_POR_IMPAGO'] } },
    include: { empresa: { select: { id: true, nombre: true, esDemo: true } } },
  });

  const resumen = { revisadas: pendientes.length, avisos1: 0, avisos2: 0, cortes: 0, errores: 0 };
  for (const s of pendientes) {
    const accion = accionImpago(s, ahora);
    if (!accion || s.empresa.esDemo) continue;
    try {
      const base = { empresaId: s.empresaId, nombreEmpresa: s.empresa.nombre, monto: s.montoMensualActual };
      // Solo se escribe si el impago sigue abierto y en la misma etapa que se leyó.
      const donde = { id: s.id, impagoDesde: { not: null }, avisosImpagoEnviados: s.avisosImpagoEnviados };
      if (accion === ACCION.AVISO_1) {
        const corte = calcularCorteImpago(ahora);
        console.log(`[impagos] ${s.empresa.nombre}: AVISO_1, corte el ${corte.toISOString()}${dryRun ? ' (dry-run)' : ''}`);
        if (!dryRun) {
          await enviarAvisoImpago('AVISO_1', { ...base, fechaCorte: corte });
          await prisma.suscripcion.updateMany({ where: donde, data: { avisosImpagoEnviados: 1, corteImpagoEn: corte } });
        }
        resumen.avisos1++;
      } else if (accion === ACCION.AVISO_2) {
        const corte = corteTrasAviso2(s.corteImpagoEn, ahora);
        console.log(`[impagos] ${s.empresa.nombre}: AVISO_2, corte el ${corte.toISOString()}${dryRun ? ' (dry-run)' : ''}`);
        if (!dryRun) {
          await enviarAvisoImpago('AVISO_2', { ...base, fechaCorte: corte });
          await prisma.suscripcion.updateMany({ where: donde, data: { avisosImpagoEnviados: 2, corteImpagoEn: corte } });
        }
        resumen.avisos2++;
      } else if (accion === ACCION.CORTE) {
        console.log(`[impagos] ${s.empresa.nombre}: CORTE${dryRun ? ' (dry-run)' : ''}`);
        if (!dryRun) {
          // Se reconfirma el impago justo antes de cortar: si pagó hace un instante, no se corta.
          const vigente = await prisma.suscripcion.findFirst({ where: donde, select: { id: true } });
          if (!vigente) {
            console.log(`[impagos] ${s.empresa.nombre}: el impago ya no está vigente, no se corta.`);
            continue;
          }
          await prisma.suscripcion.updateMany({ where: donde, data: { avisosImpagoEnviados: 3, estado: 'PAUSADA_POR_IMPAGO' } });
          // El correo del corte va DESPUÉS de pausar y su falla no revierte el corte (ya
          // se enviaron los dos avisos obligatorios); se registra para revisarlo.
          try {
            await enviarAvisoImpago('CORTE', { ...base, fechaCorte: s.corteImpagoEn });
          } catch (errCorte) {
            console.error(`[impagos] ${s.empresa.nombre}: pausada, pero el correo de aviso del corte falló:`, errCorte.message);
          }
        }
        resumen.cortes++;
      }
    } catch (err) {
      resumen.errores++;
      console.error(`[impagos] ${s.empresa.nombre}: ${accion} falló, se reintenta mañana:`, err.message);
    }
  }
  console.log('[impagos] Resumen:', JSON.stringify(resumen));
  return resumen;
}

function iniciarJobImpagos() {
  if (process.env.AVISOS_IMPAGO_ACTIVO !== 'true') {
    console.log('[impagos] Job de avisos/corte por impago programado pero APAGADO (AVISOS_IMPAGO_ACTIVO != true).');
  }
  cron.schedule('15 9 * * *', async () => {
    if (process.env.AVISOS_IMPAGO_ACTIVO !== 'true') return;
    try {
      await procesarImpagos();
    } catch (err) {
      console.error('[impagos] Error en el job:', err);
    }
  }, { timezone: 'America/Santiago' });
}

module.exports = { iniciarJobImpagos, procesarImpagos };
