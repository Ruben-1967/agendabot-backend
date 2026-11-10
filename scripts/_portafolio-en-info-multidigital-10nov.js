#!/usr/bin/env node
/**
 * El bot de Multidigital le dijo a un prospecto (+56 9 8137 1439, 10-nov 08:43) que "no puedo
 * confirmar el enlace de portafolio que compartí, así que no te fíes de él". Causa: el job
 * src/jobs/enviarPortafolio.js manda el link y lo guarda en el historial con rol 'asistente', pero
 * ni el guion ni la información del bot mencionan el portafolio; el modelo ve "su" mensaje con un
 * link que no conoce y se desdice. Este script agrega el portafolio a la información adicional.
 *
 * Además, en DRY-RUN muestra los últimos mensajes de esa conversación (solo lectura) para
 * confirmar la causa y ver por qué el bot también "corrigió" el precio del hosting.
 *
 * Reemplaza una frase exacta; si no calza, se detiene sin guardar nada. Imprime el texto
 * anterior para poder volver atrás. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_portafolio-en-info-multidigital-10nov.js
 *   APLICAR=1 node scripts/_portafolio-en-info-multidigital-10nov.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const TELEFONO_CASO = '56981371439';
const URL_PORTAFOLIO = 'https://muestras.multidigital.cl/portafolio.html';

const ANCLA = 'Si más adelante quiere el sitio web, se suma sin perder los correos.';
const NUEVO = `${ANCLA}
- Portafolio: ${URL_PORTAFOLIO} es el portafolio real de Multidigital, con sitios que hemos hecho. Lo enviamos nosotros (a veces de forma automática a quien deja de responder), así que si aparece en la conversación es correcto: nunca digas que no puedes confirmarlo ni que no se fíen de él. Puedes compartirlo cuando pidan ver trabajos, ejemplos o sitios que hemos hecho.`;

async function mostrarCaso() {
  const conv = await prisma.conversacion.findFirst({
    where: { empresaId: EMPRESA_ID, telefono: TELEFONO_CASO },
    orderBy: { actualizadoEn: 'desc' },
    select: { mensajes: true },
  });
  if (!conv) return console.log(`(No se encontró la conversación de ${TELEFONO_CASO}.)\n`);
  const mensajes = Array.isArray(conv.mensajes) ? conv.mensajes : [];
  console.log(`=== CONVERSACIÓN ${TELEFONO_CASO}: últimos ${Math.min(12, mensajes.length)} de ${mensajes.length} mensajes ===`);
  for (const m of mensajes.slice(-12)) {
    const texto = String(m.contenido || '').replace(/\s+/g, ' ');
    console.log(`[${String(m.timestamp || '').slice(0, 16)}] ${m.rol}: ${texto.slice(0, 400)}`);
  }
  console.log('');
}

async function main() {
  await mostrarCaso();
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!e) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  const info = e.informacionAdicional || '';
  if (info.includes(URL_PORTAFOLIO)) {
    console.log('El portafolio ya está en la información. No hay nada que hacer.');
    return;
  }
  const veces = info.split(ANCLA).length - 1;
  if (veces !== 1) throw new Error(`La frase ancla aparece ${veces} veces (se esperaba 1): "${ANCLA}"`);
  const nueva = info.replace(ANCLA, () => NUEVO);

  console.log(`Empresa: ${e.nombre}\n+ ${NUEVO.split('\n')[1]}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_portafolio-en-info-multidigital-10nov.js');
    return;
  }
  console.log(`=== RESPALDO (texto anterior) ===\n${JSON.stringify({ informacionAdicional: e.informacionAdicional })}\n`);
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: nueva } });
  console.log('✅ Guardado.');
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
