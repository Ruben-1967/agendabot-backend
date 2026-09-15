#!/usr/bin/env node
// Uso puntual, solo lectura/diagnóstico: reproduce el caso real donde el
// bot cayó en el mensaje genérico "Disculpa, ¿puedes repetir tu mensaje?"
// tras el cambio de modelo a Sonnet 5 (2026-09-16) -- llama directo a la
// API de Anthropic (sin pasar por generarRespuestaChatbot) para ver el
// response.stop_reason y los tipos de bloques de response.content
// crudos. Hipótesis a confirmar: Sonnet 5 corre "thinking" adaptativo por
// defecto cuando no se especifica el parámetro "thinking" -- y like
// max_tokens: 500 (heredado de cuando el modelo era Haiku, que no piensa)
// podría estar agotándose con el thinking antes de dejar espacio para la
// respuesta de texto/tool_use real.
//
// USO (Shell de Render, producción -- necesita ANTHROPIC_API_KEY):
//   node scripts/_diagnostico-respuesta-vacia-sonnet.js

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../src/lib/prisma');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  const servicios = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID, activo: true } });

  const systemPrompt = `Eres el asistente de agendamiento de "${empresa.nombre}", vía WhatsApp.
SERVICIOS AGENDABLES:
${servicios.map((s) => `- ${s.nombre}`).join('\n')}
Instrucciones: sé breve. Si el cliente ya te dijo su nombre pero no el servicio, pregúntale amablemente cuál servicio necesita, sin repetir literalmente lo que ya preguntaste antes.`;

  const messages = [
    { role: 'user', content: '¿Para cuál de estos servicios necesitas la hora?' },
    { role: 'assistant', content: '¿Para cuál de estos servicios necesitas la hora? 👇' },
    { role: 'user', content: 'Soy la sra Rosa Levi' },
  ];

  console.log('Llamando a la API con max_tokens: 500 (el valor actual en claude.js), sin especificar "thinking"...\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 500,
    system: systemPrompt,
    messages,
  });

  console.log('stop_reason:', response.stop_reason);
  console.log('usage:', JSON.stringify(response.usage));
  console.log('\nBloques en response.content:');
  for (const block of response.content) {
    if (block.type === 'thinking') {
      console.log(`  - thinking (${block.thinking?.length || 0} caracteres de texto de razonamiento)`);
    } else if (block.type === 'text') {
      console.log(`  - text: "${block.text}"`);
    } else {
      console.log(`  - ${block.type}`);
    }
  }
}

main()
  .catch((err) => console.error('❌ Error:', err.message))
  .finally(() => prisma.$disconnect());
