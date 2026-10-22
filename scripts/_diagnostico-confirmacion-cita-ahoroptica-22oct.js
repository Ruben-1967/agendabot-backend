#!/usr/bin/env node
/**
 * SOLO LECTURA (2026-10-22). Ahorróptica reportó que un cliente respondió "Sí, confirmo" a
 * un recordatorio de cita y el bot contestó con el menú genérico ("¿Me puedes contar a qué
 * te refieres?...") en vez de confirmar la cita. server.js busca la cita pendiente con
 *   cita.findFirst({ estado:'PENDIENTE', confirmacionIntentos:{gt:0}, cliente:{ telefono: <from del webhook> } })
 * y si no la encuentra, el mensaje cae al pipeline general. Este script reproduce esa búsqueda
 * para un teléfono y muestra POR QUÉ no calza: cómo está guardado el teléfono del cliente
 * (con o sin 56), y el estado de sus citas. No escribe nada, no manda mensajes, no imprime RUT.
 *
 * Uso (Shell de Render, producción):
 *   TELEFONO=993088627 node scripts/_diagnostico-confirmacion-cita-ahoroptica-22oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const soloDigitos = (t) => String(t || '').replace(/\D/g, '');

async function main() {
  const entrada = soloDigitos(process.env.TELEFONO);
  if (entrada.length < 9) throw new Error('Falta TELEFONO=<al menos 9 dígitos>.');
  const ultimos9 = entrada.slice(-9);
  const conPais = `56${ultimos9}`;

  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true } });
  if (!empresa || !/ahor/i.test(empresa.nombre)) throw new Error('No es la Empresa Ahorróptica -- no se hace nada.');

  // Todos los Cliente cuyo teléfono TERMINA en esos 9 dígitos (con o sin 56, +, espacios).
  const candidatos = await prisma.cliente.findMany({
    where: { empresaId: EMPRESA_ID, OR: [{ telefono: { contains: ultimos9 } }, { telefonoContacto: { contains: ultimos9 } }] },
    select: { id: true, nombre: true, telefono: true, telefonoContacto: true, creadoEn: true },
    orderBy: { creadoEn: 'asc' },
  });
  console.log(`Clientes de ${empresa.nombre} con teléfono que contiene ${ultimos9}: ${candidatos.length}`);
  for (const c of candidatos) {
    console.log(`- ${c.id} | ${c.nombre} | telefono="${c.telefono}" | telefonoContacto="${c.telefonoContacto || ''}" | creado ${c.creadoEn?.toISOString?.().slice(0, 10)}`);
  }

  const ahora = new Date();
  for (const c of candidatos) {
    const citas = await prisma.cita.findMany({
      where: { clienteId: c.id, fechaHoraInicio: { gte: new Date(ahora.getTime() - 24 * 3600 * 1000) } },
      select: { id: true, estado: true, confirmacionIntentos: true, fechaHoraInicio: true, nombrePaciente: true },
      orderBy: { fechaHoraInicio: 'asc' },
    });
    console.log(`\nCitas próximas de ${c.nombre} (${c.telefono}): ${citas.length}`);
    for (const k of citas) {
      console.log(`   ${k.fechaHoraInicio.toISOString()} | estado=${k.estado} | confirmacionIntentos=${k.confirmacionIntentos} | paciente=${k.nombrePaciente || '(sin dato)'}`);
    }
  }

  // Lo que hace el webhook: telefono EXACTO igual al "from" de WhatsApp (con 56, solo dígitos).
  const exacta = await prisma.cita.findFirst({
    where: { empresaId: EMPRESA_ID, estado: 'PENDIENTE', confirmacionIntentos: { gt: 0 }, cliente: { telefono: conPais } },
    select: { id: true, fechaHoraInicio: true },
    orderBy: { fechaHoraInicio: 'asc' },
  });
  const sinPais = await prisma.cita.findFirst({
    where: { empresaId: EMPRESA_ID, estado: 'PENDIENTE', confirmacionIntentos: { gt: 0 }, cliente: { telefono: { endsWith: ultimos9 } } },
    select: { id: true, fechaHoraInicio: true, cliente: { select: { telefono: true } } },
    orderBy: { fechaHoraInicio: 'asc' },
  });
  console.log(`\nBúsqueda EXACTA del webhook (telefono="${conPais}"): ${exacta ? `ENCUENTRA la cita ${exacta.id}` : 'NO encuentra ninguna cita pendiente'}`);
  console.log(`Búsqueda por los últimos 9 dígitos: ${sinPais ? `encuentra la cita ${sinPais.id} (cliente guardado como "${sinPais.cliente.telefono}")` : 'tampoco encuentra ninguna'}`);
  if (!exacta && sinPais) console.log('\n=> CAUSA: el teléfono del cliente está guardado en otro formato; la cita existe pero la búsqueda exacta no la ve.');
  if (!exacta && !sinPais) console.log('\n=> No hay cita PENDIENTE con confirmacionIntentos>0: revisar el estado de las citas de arriba (¿ya CONFIRMADA?, ¿intentos en 0?).');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
