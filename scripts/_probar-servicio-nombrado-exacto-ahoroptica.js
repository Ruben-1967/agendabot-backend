#!/usr/bin/env node
/**
 * Reproduce el bug real reportado (Ahorróptica, 2026-09-15): el bot ya
 * había preguntado por el servicio, el cliente escribió el nombre EXACTO
 * del único servicio real ("Evaluación examen visual"), y el bot volvió a
 * pedir que elija del menú en vez de avanzar a mostrar días disponibles.
 *
 * Mismo patrón seguro que los demás scripts _probar-*-ahoroptica.js:
 * teléfono de prueba fijo, guardia contra pisar un cliente real, limpieza
 * al final.
 *
 * USO (Shell de Render, producción -- Ahorróptica solo existe ahí):
 *   node scripts/_probar-servicio-nombrado-exacto-ahoroptica.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { generarRespuestaChatbot } = require('../src/services/claude');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';
const TELEFONO_PRUEBA = '+56900000501';

const TURNOS_CLIENTE = [
  'Hola, quiero agendar una hora',
  'Evaluación examen visual',
];

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, include: { rubroTemplate: true } });
  console.log('Empresa:', empresa.nombre);

  let cliente = await prisma.cliente.findFirst({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
  if (cliente && cliente.nombre !== 'PRUEBA CLAUDE') {
    throw new Error(`Teléfono de prueba ya usado por un cliente real (${cliente.nombre}) — abortando.`);
  }
  if (!cliente) {
    cliente = await prisma.cliente.create({ data: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA, nombre: 'PRUEBA CLAUDE' } });
  }

  const historial = [];
  let ok = false;
  try {
    for (let i = 0; i < TURNOS_CLIENTE.length; i++) {
      const mensajeEntrante = TURNOS_CLIENTE[i];
      console.log(`\n>>> CLIENTE (turno ${i + 1}):`, mensajeEntrante);

      const resultado = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante });
      console.log('<<< BOT:', resultado.texto);
      console.log('    interactivo:', resultado.interactivo ? resultado.interactivo.tipo : null);

      historial.push(
        { rol: 'usuario', contenido: mensajeEntrante, timestamp: new Date().toISOString() },
        { rol: 'asistente', contenido: resultado.texto, timestamp: new Date().toISOString() }
      );

      if (i === 1) {
        ok = resultado.interactivo?.tipo === 'lista_dias' || resultado.interactivo?.tipo === 'lista_horarios';
      }
    }

    console.log(ok
      ? '\n✅ El segundo turno (nombrando el servicio exacto) avanzó a mostrar días/horarios, no repitió la lista de servicios.'
      : '\n⚠️  FALLÓ: el bot no avanzó tras recibir el nombre exacto del servicio.');
  } finally {
    await prisma.cita.deleteMany({ where: { clienteId: cliente.id } });
    await prisma.conversacion.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.delete({ where: { id: cliente.id } });
  }
}

main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
