// Job programado (Render Cron Job, sugerido cada 15-20 minutos): revisa las
// citas PENDIENTES próximas y gestiona el recordatorio de confirmación en
// hasta 3 intentos:
//
//   Intento 1: cuando faltan 24h o menos para la cita.
//   Intento 2: 1 hora después del intento 1, si sigue sin confirmar.
//   Intento 3 (último aviso): 1 hora después del intento 2, avisando que si
//             no responde ahora, la hora se libera.
//   Cancelación automática: 1 hora después del intento 3, si sigue sin
//             responder — libera el cupo (vuelve a aparecer disponible).
//
// La confirmación en sí (cuando el cliente responde "Sí"/"No") se procesa en
// el webhook (server.js), no acá — este job solo envía los recordatorios y
// cancela cuando se agotan los intentos.

require('dotenv').config();
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { descifrarSiCorresponde } = require('../lib/cifrado');

// Nombres de las plantillas de WhatsApp — deben existir y estar aprobadas en
// Meta antes de que este job funcione de verdad. Ver notas de despliegue.
const PLANTILLA_RECORDATORIO = 'confirmacion_cita_recordatorio'; // intentos 1 y 2, mismo texto
const PLANTILLA_ULTIMO_AVISO = 'confirmacion_cita_ultimo_aviso'; // intento 3

const HORAS_ANTES_PRIMER_INTENTO = 24;
const HORAS_ENTRE_INTENTOS = 1;
// Si el cliente agenda con 24h o menos de anticipación, la condición de
// arriba se cumple al toque — el primer recordatorio salía casi al mismo
// tiempo que la confirmación del bot, en vez de sentirse como un
// recordatorio real. Este mínimo evita eso: el primer intento espera a que
// pasen 24h desde que se creó la cita, además de estar a 24h o menos de la
// hora real. Solo afecta al primer intento — el resto del ciclo (2do
// aviso/último aviso/cancelación) sigue anclado a la fecha de la cita, sin
// tocar, para no debilitar la protección de no-show. Pedido 2026-09-03.
const HORAS_MINIMAS_DESDE_CREACION = 24;

function horasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60);
}

function formatearFechaHoraChile(fecha) {
  const fechaLegible = fecha.toLocaleDateString('es-CL', {
    day: 'numeric', month: 'long', timeZone: 'America/Santiago',
  });
  const horaLegible = fecha.toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago',
  });
  return { fechaLegible, horaLegible };
}

async function procesarConfirmacionesDeCitas() {
  const ahora = new Date();

  // Traemos solo citas PENDIENTES cuyo ciclo de confirmación no se haya
  // agotado todavía (0-3 intentos; en 3 decidimos si cancelar).
  const citas = await prisma.cita.findMany({
    where: { estado: 'PENDIENTE', confirmacionIntentos: { lte: 3 } },
    include: { cliente: true, empresa: true, servicio: true },
  });

  let enviados1 = 0, enviados2 = 0, enviados3 = 0, cancelados = 0, omitidos = 0;

  for (const cita of citas) {
    const empresa = cita.empresa;
    const cliente = cita.cliente;

    if (!empresa.whatsappNumeroId || !cliente.telefono) {
      omitidos++;
      continue; // sin WhatsApp real conectado, o cliente sin teléfono — no hay a quién avisar
    }

    // whatsappToken llega anidado (Cita -> Empresa), la extensión de Prisma
    // no lo descifra automáticamente ahí — sin esto, el recordatorio de
    // 24h/1h antes de la cita fallaba en silencio para cualquier empresa
    // con token propio (ej. Ahorróptica).
    const accessToken = descifrarSiCorresponde(empresa.whatsappToken) || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      omitidos++;
      continue;
    }

    const horasHastaCita = horasEntre(cita.fechaHoraInicio, ahora);
    const horasDesdeUltimoEnvio = cita.confirmacionUltimoEnvioEn
      ? horasEntre(ahora, cita.confirmacionUltimoEnvioEn)
      : Infinity;
    const horasDesdeCreacion = horasEntre(ahora, cita.creadoEn);

    const { fechaLegible, horaLegible } = formatearFechaHoraChile(cita.fechaHoraInicio);
    const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;
    const variables = [cliente.nombre || 'Hola', nombreEmpresa, fechaLegible, horaLegible];

    try {
      if (cita.confirmacionIntentos === 0) {
        // Ignoramos citas ya muy antiguas (más de 1h en el pasado) para no
        // mandar un primer recordatorio fuera de lugar si esta funcionalidad
        // se activó con citas viejas ya cargadas.
        if (
          horasHastaCita <= HORAS_ANTES_PRIMER_INTENTO &&
          horasHastaCita > -1 &&
          horasDesdeCreacion >= HORAS_MINIMAS_DESDE_CREACION
        ) {
          await sendWhatsAppTemplateMessage({
            phoneNumberId: empresa.whatsappNumeroId, to: cliente.telefono, accessToken,
            templateName: PLANTILLA_RECORDATORIO, variables,
          });
          await prisma.cita.update({
            where: { id: cita.id },
            data: { confirmacionIntentos: 1, confirmacionUltimoEnvioEn: ahora },
          });
          enviados1++;
        }
      } else if (cita.confirmacionIntentos === 1 && horasDesdeUltimoEnvio >= HORAS_ENTRE_INTENTOS) {
        await sendWhatsAppTemplateMessage({
          phoneNumberId: empresa.whatsappNumeroId, to: cliente.telefono, accessToken,
          templateName: PLANTILLA_RECORDATORIO, variables,
        });
        await prisma.cita.update({
          where: { id: cita.id },
          data: { confirmacionIntentos: 2, confirmacionUltimoEnvioEn: ahora },
        });
        enviados2++;
      } else if (cita.confirmacionIntentos === 2 && horasDesdeUltimoEnvio >= HORAS_ENTRE_INTENTOS) {
        await sendWhatsAppTemplateMessage({
          phoneNumberId: empresa.whatsappNumeroId, to: cliente.telefono, accessToken,
          templateName: PLANTILLA_ULTIMO_AVISO, variables,
        });
        await prisma.cita.update({
          where: { id: cita.id },
          data: { confirmacionIntentos: 3, confirmacionUltimoEnvioEn: ahora },
        });
        enviados3++;
      } else if (cita.confirmacionIntentos === 3 && horasDesdeUltimoEnvio >= HORAS_ENTRE_INTENTOS) {
        // Se agotaron los 3 intentos sin respuesta — se libera el cupo.
        // No hace falta tocar disponibilidad.js: al pasar a CANCELADA, el
        // motor de disponibilidad ya la excluye automáticamente (solo
        // considera PENDIENTE/CONFIRMADA como ocupadas).
        await prisma.cita.update({
          where: { id: cita.id },
          data: { estado: 'CANCELADA', canceladaPorNoConfirmar: true },
        });
        cancelados++;
        console.log(`Cita ${cita.id} cancelada por falta de confirmación (${nombreEmpresa}, ${cliente.nombre}, ${fechaLegible} ${horaLegible}).`);
      }
    } catch (error) {
      console.error(`Error procesando confirmación de cita ${cita.id}:`, error.message);
    }
  }

  console.log(
    `\nResumen: intento1=${enviados1}, intento2=${enviados2}, ultimoAviso=${enviados3}, ` +
    `canceladas=${cancelados}, omitidas=${omitidos} (de ${citas.length} citas pendientes revisadas).`
  );
}

procesarConfirmacionesDeCitas()
  .catch((err) => {
    console.error('Error general en el job de confirmación de citas:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());