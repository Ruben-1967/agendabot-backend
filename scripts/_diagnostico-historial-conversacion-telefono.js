#!/usr/bin/env node
// Uso puntual: imprime el historial COMPLETO (mensajes.rol/contenido/timestamp)
// de la Conversacion de un teléfono puntual, para diagnosticar el bug real
// reportado por Ahorróptica ("el bot repite ¿Para cuál de estos servicios
// necesitas la hora? sin mostrar alternativas") -- comparar los timestamps
// de los mensajes "usuario" contra las líneas "Respondido a <tel>" de los
// logs de Render permite distinguir:
//   - condición de carrera (2 mensajes casi simultáneos del cliente, cada
//     uno procesado por un webhook concurrente que lee el mismo historial
//     stale y pisa el update del otro -- ver chatbotEngine.js, sin lock) de
//   - un simple malentendido (el cliente respondió algo que Claude no supo
//     interpretar como elegir un servicio, y por eso volvió a preguntar).
// Si el historial en base tiene MENOS turnos "asistente" con el texto fijo
// de la pregunta de servicios que veces que aparece "Respondido a <tel>" en
// los logs de Render para el mismo teléfono, es señal fuerte de que un
// upsert pisó a otro (condición de carrera confirmada).
// Solo lectura, no manda nada.
//
// USO (Shell de Render, producción):
//   TELEFONO=56975464241 node scripts/_diagnostico-historial-conversacion-telefono.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

async function main() {
  const telefono = process.env.TELEFONO;
  if (!telefono) {
    throw new Error('Falta TELEFONO -- correr como: TELEFONO="56975464241" node scripts/_diagnostico-historial-conversacion-telefono.js');
  }

  const conversacion = await prisma.conversacion.findFirst({
    where: { empresaId: EMPRESA_ID, telefono },
  });

  if (!conversacion) {
    console.log(`No se encontró ninguna Conversacion para el teléfono "${telefono}" en Ahorróptica.`);
    return;
  }

  console.log(`Conversacion ${conversacion.id} — canal: ${conversacion.canal} — pausadaPorHumanoEn: ${conversacion.pausadaPorHumanoEn || 'null'}`);
  console.log(`Total de turnos guardados: ${conversacion.mensajes?.length || 0}\n`);

  const mensajes = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  for (const m of mensajes) {
    const marcaTiempo = m.timestamp ? new Date(m.timestamp).toISOString() : '(sin timestamp)';
    console.log(`[${marcaTiempo}] ${m.rol.toUpperCase()}: ${m.contenido}`);
  }

  const preguntasServicio = mensajes.filter(
    (m) => m.rol === 'asistente' && m.contenido === '¿Para cuál de estos servicios necesitas la hora? 👇'
  );
  console.log(`\nLa pregunta fija de servicios aparece ${preguntasServicio.length} vez/veces en el historial guardado.`);
  console.log('Compara este número contra cuántas veces aparece "Respondido a ' + telefono + '" en los logs de Render para el mismo rango de tiempo -- si en los logs aparece MÁS veces que acá, confirma que un upsert concurrente pisó al otro (condición de carrera).');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
