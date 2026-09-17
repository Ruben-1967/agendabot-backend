#!/usr/bin/env node
// Prueba de humo de redactarMensajePaso() (paso 4 del fix estructural,
// ver src/services/claude.js) -- llama a Claude de verdad (necesita
// ANTHROPIC_API_KEY), pero SIN tocar la base de datos: empresa es un
// objeto en memoria, no una Empresa real. Confirma 2 cosas para cada paso:
// (a) siempre devuelve texto no vacío, (b) nunca vosea (ni siquiera cuando
// el cliente escribe en voseo), y (c) nunca repite un dato que ya aparece
// en reservaEnCurso (ej. no debe volver a preguntar el servicio si
// reservaEnCurso.servicioId ya está).
//
// USO:
//   node scripts/_probar-redactar-mensaje-paso.js

require('dotenv').config();
const { redactarMensajePaso } = require('../src/services/claude');
const { PASOS } = require('../src/services/flujoReserva');

const EMPRESA_PRUEBA = {
  id: 'empresa-en-memoria-no-real',
  nombre: 'Óptica de Prueba',
  sucursal: null,
  tonoComunicacion: 'Neutral',
};

const REGEX_VOSEO = /\b(vos|ten[eé]s|pod[eé]s|quer[eé]s|necesit[aá]s(?!\s)|sab[eé]s|ven[ií]s|dec[ií]s|\bsos\b|and[aá]s?)\b/i;

const casos = [
  {
    descripcion: 'PEDIR_DIA, reserva vacía',
    paso: PASOS.PEDIR_DIA,
    reservaEnCurso: {},
    mensajeEntrante: 'Hola, quiero agendar una hora',
  },
  {
    descripcion: 'PEDIR_NOMBRE, día y hora ya confirmados (no debe volver a mencionarlos como pendientes)',
    paso: PASOS.PEDIR_NOMBRE,
    reservaEnCurso: { fecha: '2026-09-26', hora: '12:30' },
    mensajeEntrante: null,
  },
  {
    descripcion: 'CONFIRMAR, todo listo -- debe recapitular los datos tal cual',
    paso: PASOS.CONFIRMAR,
    reservaEnCurso: { fecha: '2026-09-26', hora: '12:30', nombre: 'Rosa Levi', servicioNombre: 'Evaluación examen visual' },
    mensajeEntrante: 'dale',
  },
  {
    descripcion: 'PEDIR_HORA, cliente escribe EN VOSEO -- el bot igual debe tutear',
    paso: PASOS.PEDIR_HORA,
    reservaEnCurso: { fecha: '2026-09-26' },
    mensajeEntrante: '¿A qué hora tenés disponible?',
  },
];

async function main() {
  let fallos = 0;

  for (const caso of casos) {
    console.log(`\n--- ${caso.descripcion} ---`);
    const texto = await redactarMensajePaso({
      empresa: EMPRESA_PRUEBA,
      reservaEnCurso: caso.reservaEnCurso,
      paso: caso.paso,
      mensajeEntrante: caso.mensajeEntrante,
    });
    console.log(`BOT: ${texto}`);

    if (!texto) {
      console.log('⚠️  Texto vacío/null -- el caller debería usar PLANTILLAS_DETERMINISTAS en este caso.');
      fallos++;
      continue;
    }

    if (REGEX_VOSEO.test(texto)) {
      console.log('⚠️  El texto contiene voseo.');
      fallos++;
    } else {
      console.log('✅ Sin voseo.');
    }
  }

  console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todos los casos OK.' : `${fallos} fallo(s) -- revisar arriba.`}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
