// Job programado (Render Cron Job): revisa a quién le corresponde el
// recordatorio de control anual (rubro óptica) y se lo envía por WhatsApp.
//
// Se ejecuta una vez, hace su trabajo, y termina — así funciona un Cron Job
// en Render (a diferencia del Web Service, que queda corriendo indefinidamente).

require('dotenv').config();
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { mesesDesde, esElegible } = require('../lib/recordatorioControlAnual');

// Restringido a LuxVision a propósito (decisión 2026-09-08): mensaje de
// categoría Marketing, sin claridad todavía sobre el costo real para operar
// esto en otras empresas — mismo guard ya usado en las rutas del panel
// (empresa.js, recordatorioControlAnual.js). Para abrirlo a "proactivas"
// hace falta primero un modelo de prepago, igual al de campañas de catálogo
// rotativo (créditos), no solo quitar esta línea.
const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';

// Tope de envíos por corrida del cron. Se queda cómodamente bajo el límite
// diario de conversaciones nuevas de Meta (250 sin verificación de negocio),
// dejando margen para otros mensajes salientes del mismo día.
// Ajustable según el volumen real y el estado de verificación de la cuenta.
const LIMITE_ENVIOS_POR_CORRIDA = 80;

async function procesarRecordatoriosControlAnual() {
  // Solo empresas de rubro óptica, con WhatsApp conectado de verdad, y que no
  // hayan pausado el envío desde el panel (recordatorioControlAnualPausado).
  const empresas = await prisma.empresa.findMany({
    where: {
      id: EMPRESA_ID_LUXVISION,
      rubroTemplate: { clave: 'optica' },
      whatsappNumeroId: { not: null },
      recordatorioControlAnualPausado: false,
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
      if (!esElegible(cliente)) continue;
      const mesesSinControl = mesesDesde(cliente.fichaJson.receta.fecha);
      candidatos.push({ empresa, cliente, mesesSinControl, accessToken });
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
        // "_v2" (2026-09-08): el nombre original quedó bloqueado 4 semanas
        // en Meta tras un intento previo fallido — ver
        // scripts/_crear-plantilla-recordatorio-control-anual-luxvision.js.
        templateName: 'recordatorio_control_anual_v2',
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