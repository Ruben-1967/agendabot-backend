#!/usr/bin/env node
/**
 * Envía a revisión (vía Graph API) la plantilla de WhatsApp que usa
 * src/jobs/bloquearEmpresasVencidas.js para avisar a un negocio que su
 * prueba venció y sigue sin pagar. Alternativa a crearla a mano en
 * WhatsApp Manager (Meta Business Manager > cuenta del número demo >
 * Plantillas de mensajes) — hace exactamente lo mismo, por API.
 *
 * Requiere DEMO_WHATSAPP_ACCESS_TOKEN (ya en el entorno) y
 * DEMO_WHATSAPP_WABA_ID (el "ID de la cuenta de WhatsApp Business" del
 * número demo — no confundir con el phone_number_id). El número de prueba
 * NO aparece en WhatsApp Manager (business.facebook.com) — vive dentro de
 * la App en developers.facebook.com > Mis Apps > "Totemsystem Demos" >
 * Casos de uso > WhatsApp > Configuración de la API. Ahí Meta muestra el
 * par número/WABA ID directo (confirmado: WABA 1022360410721153,
 * phone_number_id 1218967037965089 — coincide con DEMO_PHONE_NUMBER_ID).
 *
 * Uso (Render Shell):
 *   node scripts/crear-plantilla-prueba-vencida.js
 *
 * Después de correrlo, la plantilla queda "En revisión" en WhatsApp Manager
 * — Meta tarda de un par de horas a 1-2 días en aprobarla o rechazarla. No
 * hace falta volver a correr este script salvo que la rechacen y haya que
 * reintentar con otro texto.
 */

require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
// v2 también quedó rechazada (ver historial en el comentario de más abajo,
// junto al body) — nombre nuevo de nuevo, así no hay que lidiar con el
// cooldown de Meta para reusar un nombre recién rechazado.
// Debe coincidir con TEMPLATE_PRUEBA_VENCIDA en bloquearEmpresasVencidas.js
const NOMBRE_PLANTILLA = 'agendabot_prueba_vencida_v3';

async function main() {
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.DEMO_WHATSAPP_WABA_ID;

  if (!accessToken) {
    console.error('Falta DEMO_WHATSAPP_ACCESS_TOKEN en el entorno.');
    process.exit(1);
  }
  if (!wabaId) {
    console.error('\nFalta DEMO_WHATSAPP_WABA_ID en el entorno.');
    console.error('Es 1022360410721153 (confirmado: developers.facebook.com > "Totemsystem Demos" >');
    console.error('Casos de uso > WhatsApp > Configuración de la API — NO aparece en WhatsApp Manager).');
    console.error('Agrégalo en Render y volvé a correr este script.\n');
    process.exit(1);
  }

  // v1 (UTILITY): rechazada, INCORRECT_CATEGORY — "activa tu plan aquí" leído
  // como promocional. v2 (MARKETING): rechazada, INCORRECT_CATEGORY otra vez
  // — el clasificador de Meta quedó indeciso con el lenguaje de venta
  // ("reactiva el servicio", "entra... ahora"). v3: se saca todo el tono de
  // urgencia/CTA de compra, queda como aviso neutro de estado de cuenta
  // (mismo estilo que "tu pago falló, revisa tu cuenta"), vuelve a UTILITY.
  const body = {
    name: NOMBRE_PLANTILLA,
    language: 'es',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        // {{2}} no puede ser lo último del texto (Meta rechaza una variable
        // pegada al final sin texto real de cierre) — de ahí "cuando puedas." al final.
        text: 'Hola {{1}}, te informamos que tu período de prueba de AgendaBot venció. Revisa el estado de tu cuenta en {{2}} cuando puedas.',
        example: {
          body_text: [['Óptica Ejemplo', 'https://agendabot-beryl.vercel.app/suscripcion/elegir-plan?empresaId=abc123']],
        },
      },
      {
        type: 'FOOTER',
        text: 'AgendaBot — MultiDigital',
      },
    ],
  };

  console.log(`Enviando a revisión la plantilla "${NOMBRE_PLANTILLA}" (WABA ${wabaId})...\n`);

  const respuesta = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error('❌ Meta rechazó la solicitud:');
    console.error(JSON.stringify(datos, null, 2));
    process.exit(1);
  }

  console.log('✅ Plantilla enviada a revisión:');
  console.log(JSON.stringify(datos, null, 2));
  console.log('\nRevisa el estado en WhatsApp Manager > Plantillas de mensajes — pasa de "En revisión" a "Aprobada" o "Rechazada".');
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error.message);
  console.error(error);
  process.exit(1);
});
