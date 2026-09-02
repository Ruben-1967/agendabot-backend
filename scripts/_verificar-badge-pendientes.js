#!/usr/bin/env node
/**
 * Verifica la consulta que usa GET /conversaciones/:empresaId/pendientes/count
 * (el badge nuevo del panel junto a "Chats en vivo"): crea una conversación
 * de prueba con pausadaPorHumanoEn seteado, confirma que el conteo sube en 1,
 * la limpia (pausadaPorHumanoEn = null) y confirma que vuelve a bajar.
 *
 * Uso: node scripts/_verificar-badge-pendientes.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000199';

async function contar() {
  return prisma.conversacion.count({ where: { empresaId: EMPRESA_ID, pausadaPorHumanoEn: { not: null } } });
}

async function main() {
  const existente = await prisma.conversacion.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (existente) throw new Error(`Ya existe una conversación de prueba con ${TELEFONO_PRUEBA} — abortando para no pisarla.`);

  const antes = await contar();
  console.log(`Pendientes antes: ${antes}`);

  const conversacion = await prisma.conversacion.create({
    data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, mensajes: [], escaladoAHumano: true, pausadaPorHumanoEn: new Date() },
  });

  const conPausa = await contar();
  console.log(`Pendientes con la conversación de prueba pausada: ${conPausa} (esperado ${antes + 1})`);

  await prisma.conversacion.update({ where: { id: conversacion.id }, data: { pausadaPorHumanoEn: null } });
  const reactivada = await contar();
  console.log(`Pendientes tras "reactivar" (pausadaPorHumanoEn=null): ${reactivada} (esperado ${antes})`);

  await prisma.conversacion.delete({ where: { id: conversacion.id } });

  const ok = conPausa === antes + 1 && reactivada === antes;
  console.log(ok ? '\n✅ El conteo refleja correctamente el estado de pausa.' : '\n❌ El conteo NO coincide con lo esperado.');
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
