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

  let enviados = 0;
  let omitidos = 0;

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

      const yaPasaronMeses = mesesDesde(fechaReceta) >= MESES_MINIMOS_SIN_CONTROL;
      const noSeHaRecordadoRecien =
        !cliente.recordatorioControlAnualEnviadoEn ||
        diasDesde(cliente.recordatorioControlAnualEnviadoEn) >= DIAS_MINIMOS_ENTRE_RECORDATORIOS;

      if (!yaPasaronMeses || !noSeHaRecordadoRecien) {
        omitidos++;
        continue;
      }

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
        console.error(`Error enviando recordatorio a ${cliente.nombre} (${empresa.nombre}):`, error.message);
      }
    }
  }

  console.log(`\nResumen: ${enviados} recordatorios enviados, ${omitidos} clientes omitidos (sin corresponder todavía).`);
}

procesarRecordatoriosControlAnual()
  .catch((err) => {
    console.error('Error general en el job de recordatorios:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
