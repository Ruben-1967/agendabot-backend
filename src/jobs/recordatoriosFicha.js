// src/jobs/recordatoriosFicha.js
//
// Job programado (Render Cron Job standalone, sugerido cada 30-60 minutos —
// misma mecánica de invocación que confirmarCitasProximas.js, un proceso
// aparte, NO node-cron embebido en server.js): revisa las AtencionClinica con
// un ciclo de recordatorio activo y envía el mensaje que corresponda.
//
// Recordatorio escalonado del "próximo control" de ficha clínica
// (AtencionClinica.fechaProximaCitaFijada) — job separado de
// confirmarCitasProximas.js a propósito (decisión confirmada): la lógica de
// escalonamiento es distinta (3 días / 24h, no 24h/1h/1h/1h) y este flujo NO
// reserva un cupo de agenda real ni integra con Cita/ListaEspera. Editar este
// cron no puede romper el de citas normales, que ya está en producción.
//
// recordatorioModo se calcula UNA VEZ al fijar/cambiar fechaProximaCitaFijada
// (ver calcularCamposRecordatorio en src/routes/clientes.js) — este job solo
// lee ese valor y envía los mensajes que correspondan, sin recalcularlo.
//
// SIMPLE (<=3 semanas de anticipación): 1 envío a 24h antes, sin botones.
// ESCALONADO (>3 semanas): paso1 a 3 días antes (con botones sí/no), paso2 a
// 24h antes (sin botones si confirmó paso1; con botones de nuevo si no
// confirmó/declinó — mismo trato para ambos casos). Si tampoco confirma en
// el paso2, el ciclo termina ahí sin ninguna acción automática más (no hay
// Cita que liberar en esta fase).
//
// Los botones de confirmación se responden por webhook (ver server.js,
// bloque "confirmación de ficha clínica" — matchea por el TEXTO exacto del
// botón, "Sí, asisto"/"No puedo", no por un id, porque los botones de una
// plantilla aprobada no soportan un payload personalizado en este cliente
// de WhatsApp), no acá.

require('dotenv').config();
const prisma = require('../lib/prisma');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { descifrarSiCorresponde } = require('../lib/cifrado');

// Nombres de las plantillas de WhatsApp — deben existir y estar aprobadas en
// Meta antes de que este job envíe algo de verdad (ver tarea de aprobación
// aparte). Textos aprobados por Ruben:
//   SIMPLE: "Hola {{1}}, te recordamos tu control mañana en {{2}}. ¡Te esperamos!"
//   CONFIRMACION: "Hola {{1}}, tienes agendado tu próximo control en {{2}}. ¿Podrás asistir?" + botones Sí/No
const PLANTILLA_RECORDATORIO_FICHA_SIMPLE = 'recordatorio_ficha_simple';
const PLANTILLA_RECORDATORIO_FICHA_CONFIRMACION = 'recordatorio_ficha_confirmacion';

const HORAS_PASO1_ESCALONADO = 72; // 3 días
const HORAS_PASO2 = 24; // 1 día, aplica a SIMPLE (único envío) y a ESCALONADO (segundo envío)

function horasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60);
}

// {{2}} = nombre del negocio, o "{negocio} - {profesional}" si la atención
// tiene profesionalAtendio cargado. AtencionClinica no tiene vínculo a
// Servicio/RecursoAgendable (no existe esa relación en el schema hoy), así
// que se usa el texto libre que el profesional ya cargó en la atención —
// no la resolución estructurada de Opción C (ServicioRecurso), que no aplica
// acá por falta de esa relación.
function nombreDestino(empresa, profesionalAtendio) {
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} (${empresa.sucursal})` : empresa.nombre;
  return profesionalAtendio ? `${nombreEmpresa} - ${profesionalAtendio}` : nombreEmpresa;
}

async function enviarSimple({ phoneNumberId, to, accessToken, nombreCliente, destino }) {
  await sendWhatsAppTemplateMessage({
    phoneNumberId, to, accessToken,
    templateName: PLANTILLA_RECORDATORIO_FICHA_SIMPLE,
    variables: [nombreCliente, destino],
  });
}

async function enviarConfirmacion({ phoneNumberId, to, accessToken, nombreCliente, destino }) {
  await sendWhatsAppTemplateMessage({
    phoneNumberId, to, accessToken,
    templateName: PLANTILLA_RECORDATORIO_FICHA_CONFIRMACION,
    variables: [nombreCliente, destino],
  });
}

async function procesarRecordatoriosFicha() {
  const ahora = new Date();

  const atenciones = await prisma.atencionClinica.findMany({
    where: {
      fechaProximaCitaFijada: { not: null },
      recordatorioModo: { not: null },
      recordatorioPaso2EnviadoEn: null, // todavía queda algo por enviar (paso1 y/o paso2)
    },
    include: { cliente: { include: { empresa: true } } },
  });

  let enviadosPaso1 = 0, enviadosPaso2Simple = 0, enviadosPaso2Confirmacion = 0, omitidos = 0;

  for (const atencion of atenciones) {
    const cliente = atencion.cliente;
    const empresa = cliente.empresa;

    if (!empresa.whatsappNumeroId || !cliente.telefono) {
      omitidos++;
      continue;
    }
    // whatsappToken llega doblemente anidado (AtencionClinica -> Cliente ->
    // Empresa), la extensión de Prisma no lo descifra automáticamente ahí.
    const accessToken = descifrarSiCorresponde(empresa.whatsappToken) || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      omitidos++;
      continue;
    }

    const horasHastaCita = horasEntre(atencion.fechaProximaCitaFijada, ahora);
    const destino = { phoneNumberId: empresa.whatsappNumeroId, to: cliente.telefono, accessToken };
    const nombreCliente = cliente.nombre || 'Hola';
    const nombreDestinoTexto = nombreDestino(empresa, atencion.profesionalAtendio);

    try {
      if (atencion.recordatorioModo === 'SIMPLE') {
        if (horasHastaCita <= HORAS_PASO2 && horasHastaCita > -1) {
          await enviarSimple({ ...destino, nombreCliente, destino: nombreDestinoTexto });
          await prisma.atencionClinica.update({
            where: { id: atencion.id },
            data: { recordatorioPaso2EnviadoEn: ahora },
          });
          enviadosPaso2Simple++;
        }
        continue;
      }

      // ESCALONADO
      if (!atencion.recordatorioPaso1EnviadoEn) {
        if (horasHastaCita <= HORAS_PASO1_ESCALONADO && horasHastaCita > -1) {
          await enviarConfirmacion({ ...destino, nombreCliente, destino: nombreDestinoTexto });
          await prisma.atencionClinica.update({
            where: { id: atencion.id },
            data: { recordatorioPaso1EnviadoEn: ahora },
          });
          enviadosPaso1++;
        }
        continue;
      }

      // Paso1 ya enviado, falta paso2
      if (horasHastaCita <= HORAS_PASO2 && horasHastaCita > -1) {
        if (atencion.recordatorioPaso1Confirmado === true) {
          await enviarSimple({ ...destino, nombreCliente, destino: nombreDestinoTexto });
          enviadosPaso2Simple++;
        } else {
          // Sin respuesta o declinó explícitamente en paso1 -- mismo trato,
          // segunda oportunidad en modo confirmación.
          await enviarConfirmacion({ ...destino, nombreCliente, destino: nombreDestinoTexto });
          enviadosPaso2Confirmacion++;
        }
        await prisma.atencionClinica.update({
          where: { id: atencion.id },
          data: { recordatorioPaso2EnviadoEn: ahora },
        });
      }
    } catch (error) {
      console.error(`Error procesando recordatorio de ficha para atención ${atencion.id}:`, error.message);
    }
  }

  console.log(
    `\nResumen recordatoriosFicha: paso1=${enviadosPaso1}, paso2Simple=${enviadosPaso2Simple}, ` +
    `paso2Confirmacion=${enviadosPaso2Confirmacion}, omitidos=${omitidos} (de ${atenciones.length} atenciones con ciclo activo).`
  );
}

procesarRecordatoriosFicha()
  .catch((err) => {
    console.error('Error general en el job de recordatorios de ficha:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
