#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) las 2 plantillas que usa
 * src/jobs/confirmarCitasProximas.js para el recordatorio de cita
 * (confirmacion_cita_recordatorio, intentos 1 y 2) y el último aviso antes
 * de cancelar (confirmacion_cita_ultimo_aviso, intento 3).
 *
 * A diferencia de las plantillas de la plataforma (alerta_cliente_pide_humano,
 * prueba_vencida), estas viajan por el número PROPIO de cada negocio — hay
 * que crearlas en la WABA de cada cliente por separado, no una sola vez.
 * Este script usa el whatsappWabaId/whatsappToken ya guardados en la
 * Empresa, así que no hace falta ir a buscarlos a mano en Meta.
 *
 * Encontrado 2026-09-03: ninguna de las 2 existía en la WABA de
 * Ahorróptica — el cron llevaba corriendo cada 15 min desde el 2 de
 * septiembre fallando en silencio contra Meta en cada intento de envío.
 *
 * Uso (Render Shell):
 *   EMPRESA_ID=<id> node scripts/crear-plantillas-recordatorio-cita.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const GRAPH_API_VERSION = 'v21.0';

const PLANTILLAS = [
  {
    name: 'confirmacion_cita_recordatorio',
    body: {
      text: 'Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}} horas. Por favor confirma tu asistencia respondiendo Sí o No.',
      example: { body_text: [['Ayelén', 'Ahorróptica (Sucursal Lautaro)', 'sábado 12 de septiembre', '11:15']] },
    },
  },
  {
    name: 'confirmacion_cita_ultimo_aviso',
    body: {
      text: 'Hola {{1}}, este es el último aviso de tu cita en {{2}} el {{3}} a las {{4}} horas. Si no confirmas ahora, liberaremos el cupo para otra persona.',
      example: { body_text: [['Ayelén', 'Ahorróptica (Sucursal Lautaro)', 'sábado 12 de septiembre', '11:15']] },
    },
  },
];

async function main() {
  const empresaId = process.env.EMPRESA_ID;
  if (!empresaId) {
    console.error('Uso: EMPRESA_ID=<id> node scripts/crear-plantillas-recordatorio-cita.js');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  if (!empresa.whatsappWabaId) {
    console.error(`${empresa.nombre} no tiene whatsappWabaId guardado — conéctala primero.`);
    process.exit(1);
  }
  const accessToken = descifrarSiCorresponde(empresa.whatsappToken);
  if (!accessToken) {
    console.error(`${empresa.nombre} no tiene whatsappToken guardado.`);
    process.exit(1);
  }

  console.log(`Empresa: ${empresa.nombre} (WABA ${empresa.whatsappWabaId})\n`);

  for (const plantilla of PLANTILLAS) {
    console.log(`Enviando a revisión "${plantilla.name}"...`);
    const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${empresa.whatsappWabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: plantilla.name,
        language: 'es',
        category: 'UTILITY',
        components: [{ type: 'BODY', ...plantilla.body }],
      }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      console.error(`  ❌ Meta rechazó "${plantilla.name}":`, JSON.stringify(datos, null, 2));
      continue;
    }
    console.log(`  ✅ Enviada:`, JSON.stringify(datos));
  }

  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada" (horas a 1-2 días).');
}
main().catch((error) => { console.error('ERROR:', error); process.exit(1); }).finally(() => prisma.$disconnect());
