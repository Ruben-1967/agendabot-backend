// Job programado (Render Cron Job, sugerido cada 30 min, mismo patrón que
// confirmarCitasProximas.js): revisa las DemoAsignada ORGÁNICAS
// (origenDemo: 'organico' — números nuevos que escriben directo al WhatsApp
// de demos, sin carga previa ni asignación de vendedor) que ya probaron la
// demo y no convirtieron, y les envía hasta 2 mensajes automáticos de
// seguimiento — variante "precio" si preguntaron por planes/precio, variante
// "inactividad" si simplemente dejaron de responder. Si no se puede
// contactar dentro de la ventana de servicio de WhatsApp (24h desde la
// última interacción del prospecto), la demo se deriva a un vendedor.
//
// Todo el envío es texto libre (no plantilla Meta) porque, por diseño,
// siempre ocurre dentro de esa ventana de 24h.
//
// Regla de horario — dura, no preferencia: lunes a sábado, 08:00–20:00 hora
// Chile (ver src/lib/horaChile.js). Nunca se envía nada fuera de ese rango,
// ni aunque eso implique perder la ventana de 24h — en ese caso, la demo
// queda derivada a vendedor en la siguiente pasada del cron.
//
// No construye reparto automático de leads (fase 4, aparte) — solo marca
// derivadoAVendedor para que el pool sea visible/tomable (ver GET
// /demos/pool y POST /demos/pool/:id/tomar en src/routes/demos.js).

require('dotenv').config();
const prisma = require('../lib/prisma');
const { sendWhatsAppTextMessage } = require('../services/whatsapp');
const { estaEnHorarioHabilChile } = require('../lib/horaChile');

// ------------------------------------------------------------
// Umbrales — PENDIENTE DE DEFINIR con Ruben antes de deploy a producción.
// Dejados como constantes acá arriba para poder ajustarlos sin tocar la
// lógica del cron.
// ------------------------------------------------------------
const UMBRAL_PRECIO_HORAS = 2; // horas desde intencionPrecioEn, ej. 1-2h
const UMBRAL_INACTIVIDAD_HORAS = 5; // horas desde ultimaInteraccionEn, ej. 4-6h
const UMBRAL_SEGUNDO_SEGUIMIENTO_HORAS = 5; // horas desde seguimientoEnviadoEn, ej. 4-6h

const VENTANA_SERVICIO_HORAS = 24;

// ------------------------------------------------------------
// Textos de los mensajes — PENDIENTE DE DEFINIR con Ruben. Placeholders
// claros para poder reemplazarlos sin tocar la lógica de arriba/abajo.
// Índice 1 = primer seguimiento, índice 2 = segundo (sin respuesta al primero).
// ------------------------------------------------------------
const TEXTOS_SEGUIMIENTO = {
  precio: {
    1: '[PLACEHOLDER seguimiento #1 — precio] Definir texto final con Ruben.',
    2: '[PLACEHOLDER seguimiento #2 — precio, sin respuesta al primero] Definir texto final con Ruben.',
  },
  inactividad: {
    1: '[PLACEHOLDER seguimiento #1 — inactividad] Definir texto final con Ruben.',
    2: '[PLACEHOLDER seguimiento #2 — inactividad, sin respuesta al primero] Definir texto final con Ruben.',
  },
};

function horasEntre(a, b) {
  return (a - b) / (1000 * 60 * 60);
}

// Envía el mensaje de seguimiento que corresponde según `tipo` ('precio' |
// 'inactividad') y cuántos seguimientos lleva ya la demo (seguimientosEnviados
// en 0 => este es el 1er envío, en 1 => este es el 2do).
async function enviarMensajeSeguimiento(demoAsignada, tipo) {
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('Faltan DEMO_PHONE_NUMBER_ID o DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
  }

  const numeroEnvio = demoAsignada.seguimientosEnviados + 1;
  const texto = TEXTOS_SEGUIMIENTO[tipo]?.[numeroEnvio];
  if (!texto) {
    throw new Error(`No hay texto de seguimiento definido para tipo="${tipo}" numeroEnvio=${numeroEnvio}.`);
  }

  await sendWhatsAppTextMessage({ phoneNumberId, to: demoAsignada.telefono, text: texto, accessToken });
}

async function procesarSeguimientoDemos() {
  const ahora = new Date();
  const horarioHabilAhora = estaEnHorarioHabilChile(ahora);

  // Solo demos orgánicas, no eliminadas, que ya tuvieron al menos una
  // interacción real (si ultimaInteraccionEn es null, el reloj de 24h/
  // inactividad ni siquiera arrancó) y que todavía no fueron derivadas a un
  // vendedor — una vez derivada, queda para gestión manual y no se vuelve a
  // procesar acá.
  const demos = await prisma.demoAsignada.findMany({
    where: {
      origenDemo: 'organico',
      eliminadoEn: null,
      derivadoAVendedor: false,
      ultimaInteraccionEn: { not: null },
    },
  });

  let enviadosPrecio = 0, enviadosInactividad = 0, enviadosSegundo = 0, derivados = 0, omitidosPorHorario = 0;

  for (const demo of demos) {
    try {
      const horasDesdeUltimaInteraccion = horasEntre(ahora, demo.ultimaInteraccionEn);

      if (horasDesdeUltimaInteraccion >= VENTANA_SERVICIO_HORAS) {
        await prisma.demoAsignada.update({
          where: { id: demo.id },
          data: {
            derivadoAVendedor: true,
            derivadoEn: ahora,
            motivoDerivacion: 'fuera_ventana_sin_conversion',
          },
        });
        derivados++;
        continue;
      }

      if (!horarioHabilAhora) {
        // Fuera de horario hábil — no se envía nada en esta pasada, se
        // reintenta en la próxima corrida del cron. Si al abrir el próximo
        // horario hábil ya pasaron 24h, se pierde el envío automático y cae
        // en el caso de arriba en la siguiente pasada.
        omitidosPorHorario++;
        continue;
      }

      if (demo.intencionPrecioDetectada && demo.seguimientosEnviados === 0) {
        const horasDesdeIntencion = horasEntre(ahora, demo.intencionPrecioEn);
        if (horasDesdeIntencion >= UMBRAL_PRECIO_HORAS) {
          await enviarMensajeSeguimiento(demo, 'precio');
          await prisma.demoAsignada.update({
            where: { id: demo.id },
            data: { seguimientosEnviados: 1, seguimientoTipo: 'precio', seguimientoEnviadoEn: ahora },
          });
          enviadosPrecio++;
        }
        continue;
      }

      if (!demo.intencionPrecioDetectada && demo.seguimientosEnviados === 0) {
        if (horasDesdeUltimaInteraccion >= UMBRAL_INACTIVIDAD_HORAS) {
          await enviarMensajeSeguimiento(demo, 'inactividad');
          await prisma.demoAsignada.update({
            where: { id: demo.id },
            data: { seguimientosEnviados: 1, seguimientoTipo: 'inactividad', seguimientoEnviadoEn: ahora },
          });
          enviadosInactividad++;
        }
        continue;
      }

      if (
        demo.seguimientosEnviados === 1 &&
        demo.ultimaInteraccionEn <= demo.seguimientoEnviadoEn // no respondió desde el 1er seguimiento
      ) {
        const horasDesdeSeguimiento = horasEntre(ahora, demo.seguimientoEnviadoEn);
        if (horasDesdeSeguimiento >= UMBRAL_SEGUNDO_SEGUIMIENTO_HORAS) {
          const tipo = demo.seguimientoTipo || 'inactividad';
          await enviarMensajeSeguimiento(demo, tipo);
          await prisma.demoAsignada.update({
            where: { id: demo.id },
            data: { seguimientosEnviados: 2, seguimientoTipo: tipo, seguimientoEnviadoEn: ahora },
          });
          enviadosSegundo++;
        }
      }
      // seguimientosEnviados === 2 (tope alcanzado) => no hay más
      // automatización; si no convirtió, queda para gestión manual, y solo
      // se deriva por la regla de 24h de más arriba, no por agotar intentos.
    } catch (error) {
      console.error(`Error procesando seguimiento de demo ${demo.id} (${demo.telefono}):`, error.message);
    }
  }

  console.log(
    `\nResumen: precio=${enviadosPrecio}, inactividad=${enviadosInactividad}, segundoSeguimiento=${enviadosSegundo}, ` +
    `derivados=${derivados}, omitidosPorHorario=${omitidosPorHorario} (de ${demos.length} demos orgánicas revisadas).`
  );
}

procesarSeguimientoDemos()
  .catch((err) => {
    console.error('Error general en el job de seguimiento de demos:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

module.exports = { procesarSeguimientoDemos, enviarMensajeSeguimiento };
