#!/usr/bin/env node
// Uso puntual: diagnóstico de por qué el bot de Ahorróptica no está
// respondiendo -- revisa conexión de WhatsApp (sin imprimir el token) y las
// últimas conversaciones/mensajes recibidos. Solo lectura, no toca nada.
require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  const empresa = await prisma.empresa.findFirst({
    where: { nombre: { contains: 'Ahorróptica', mode: 'insensitive' } },
    select: {
      id: true, nombre: true,
      whatsappNumeroId: true, whatsappWabaId: true, whatsappPhoneNumber: true,
      whatsappToken: true, // solo para confirmar si es null o no -- no se imprime el valor
      bloqueadaPorPruebaVencida: true,
    },
  });

  if (!empresa) {
    console.error('No se encontró ninguna Empresa "Ahorróptica".');
    process.exit(1);
  }

  console.log('Empresa:', empresa.nombre, empresa.id);
  console.log('whatsappNumeroId:', empresa.whatsappNumeroId);
  console.log('whatsappWabaId:', empresa.whatsappWabaId);
  console.log('whatsappPhoneNumber:', empresa.whatsappPhoneNumber);
  console.log('tiene whatsappToken guardado:', Boolean(empresa.whatsappToken));
  console.log('bloqueadaPorPruebaVencida:', empresa.bloqueadaPorPruebaVencida);

  const conversaciones = await prisma.conversacion.findMany({
    where: { empresaId: empresa.id },
    orderBy: { actualizadoEn: 'desc' },
    take: 5,
    select: {
      id: true, telefono: true, escaladoAHumano: true, pausadaPorHumanoEn: true,
      actualizadoEn: true, creadoEn: true, mensajes: true,
    },
  });
  console.log('\nÚltimas 5 conversaciones (más reciente primero):');
  for (const c of conversaciones) {
    const ultimoMensaje = Array.isArray(c.mensajes) ? c.mensajes[c.mensajes.length - 1] : null;
    console.log(JSON.stringify({
      id: c.id, telefono: c.telefono, escaladoAHumano: c.escaladoAHumano,
      pausadaPorHumanoEn: c.pausadaPorHumanoEn, actualizadoEn: c.actualizadoEn, creadoEn: c.creadoEn,
      numMensajes: Array.isArray(c.mensajes) ? c.mensajes.length : null,
      ultimoMensaje,
    }));
  }
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
