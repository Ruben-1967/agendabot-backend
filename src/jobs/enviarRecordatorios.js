// Job programado (Render Cron Job): revisa a quién le corresponde el
// recordatorio de control anual (rubro óptica) y se lo envía por WhatsApp.
//
// Se ejecuta una vez, hace su trabajo, y termina — así funciona un Cron Job
// en Render (a diferencia del Web Service, que queda corriendo indefinidamente).

require('dotenv').config();
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');

const MESES_MINIMOS_SIN_CONTROL = 11;
const DIAS_MINIMOS_ENTRE_RECORDATORIOS = 300; // ~10 meses, evita reenviar en el mismo ciclo

// Tope de envíos por corrida del cron. Se queda cómodamente bajo el límite
// diario de conversaciones nuevas de Meta (250 sin verificación de negocio),
// dejando margen para otros mensajes salientes del mismo día.
// Ajustable según el volumen real y el estado de verificación de la cuenta.
const LIMITE_ENVIOS_POR_CORRIDA = 80;

function mesesDesde(fechaISO) {
  const fecha = new Date(fechaISO);
  const ahora = new Date();
  return (ahora - fecha) / (1000 * 60 * 60 * 24 * 30);
}

function diasDesde(fecha) {
  return (new Date() - new Date(fecha)) / (1000 * 60 * 60 * 24);
}

async function procesarRecordatoriosControlAnual() {
  // Solo empresas de rubro óptica, que ya tengan WhatsApp conectado de verdad
  const empresas = await prisma.empresa.findMany({
    where: {
      rubroTemplate: { clave: 'optica' },
      whatsappNumeroId: { not: null },
    },
    include: { clientes: true },
  });

  // 1. Armar la lista completa de "candidatos" a recordatorio, sin enviar nada todavía
  const candidatos = [];

  for (const empresa of empresas) {
    const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!accessToken) {
      console.warn(`Empresa ${empresa.nombre} sin token de WhatsApp configurado, se omite.`);
      continue;
    }

    for (const cliente of empresa.clientes) {
      const fechaReceta = cliente.fichaJson?.receta?.fecha;

      if (!fechaReceta || !cliente.telefono) {
        continue; // sin fecha de receta o sin teléfono, no hay nada que hacer
      }

      const mesesSinControl = mesesDesde(fechaReceta);
      const yaPasaronMeses = mesesSinControl >= MESES_MINIMOS_SIN_CONTROL;
      const noSeHaRecordadoRecien =
        !cliente.recordatorioControlAnualEnviadoEn ||
        diasDesde(cliente.recordatorioControlAnualEnviadoEn) >= DIAS_MINIMOS_ENTRE_RECORDATORIOS;

      if (yaPasaronMeses && noSeHaRecordadoRecien) {
        candidatos.push({ empresa, cliente, mesesSinControl, accessToken });
      }
    }
  }

  // 2. Priorizar a quien lleva MÁS tiempo atrasado, y cortar en el tope diario.
  // Así, si hay miles de candidatos, se van derritiendo de a poco cada día
  // en vez de intentar mandarlos todos juntos (lo que Meta bloquearía igual).
  candidatos.sort((a, b) => b.mesesSinControl - a.mesesSinControl);
  const aEnviarHoy = candidatos.slice(0, LIMITE_ENVIOS_POR_CORRIDA);
  const pendientesParaOtroDia = candidatos.length - aEnviarHoy.length;

  let enviados = 0;
  let fallidos = 0;

  for (const { empresa, cliente, accessToken } of aEnviarHoy) {
    try {
      await sendWhatsAppTemplateMessage({
        phoneNumberId: empresa.whatsappNumeroId,
        to: cliente.telefono,
        accessToken,
        templateName: 'recordatorio_control_anual',
        variables: [cliente.nombre, empresa.nombre],
      });

      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { recordatorioControlAnualEnviadoEn: new Date() },
      });

      // Dejamos registro en la Conversacion para que Claude tenga contexto
      // si el cliente responde tocando el botón o escribiendo algo.
      const conversacionExistente = await prisma.conversacion.findFirst({
        where: { empresaId: empresa.id, telefono: cliente.telefono },
      });

      const mensajePlano = `[Plantilla recordatorio_control_anual enviada] Hola ${cliente.nombre}, ya pasó un año desde tu último control de la vista en ${empresa.nombre}. Te recomendamos agendar una nueva evaluación.`;

      const mensajesActualizados = [
        ...(conversacionExistente?.mensajes || []),
        { rol: 'asistente', contenido: mensajePlano, timestamp: new Date().toISOString() },
      ];

      await prisma.conversacion.upsert({
        where: { id: conversacionExistente?.id || '00000000-0000-0000-0000-000000000000' },
        update: { mensajes: mensajesActualizados, clienteId: cliente.id },
        create: {
          empresaId: empresa.id,
          clienteId: cliente.id,
          telefono: cliente.telefono,
          mensajes: mensajesActualizados,
        },
      });

      enviados++;
      console.log(`Recordatorio enviado a ${cliente.nombre} (${empresa.nombre})`);
    } catch (error) {
      fallidos++;
      console.error(`Error enviando recordatorio a ${cliente.nombre} (${empresa.nombre}):`, error.message);
    }
  }

  console.log(
    `\nResumen: ${enviados} recordatorios enviados, ${fallidos} fallidos, ` +
    `${pendientesParaOtroDia} quedaron para la próxima corrida (tope diario: ${LIMITE_ENVIOS_POR_CORRIDA}).`
  );
}

procesarRecordatoriosControlAnual()
  .catch((err) => {
    console.error('Error general en el job de recordatorios:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());