#!/usr/bin/env node
// Prueba unitaria PURA de src/services/flujoReserva.js -- sin DB, sin
// Claude, sin WhatsApp. Corre en cualquier entorno (local, Staging,
// producción) con el mismo resultado, ya que flujoReserva.js no toca nada
// externo.
//
// USO:
//   node scripts/_probar-siguiente-paso-unitario.js

const { PASOS, siguientePaso, coincideConOpcionMostrada, PLANTILLAS_DETERMINISTAS } = require('../src/services/flujoReserva');

let fallos = 0;
function assertEq(descripcion, actual, esperado) {
  const ok = JSON.stringify(actual) === JSON.stringify(esperado);
  console.log(`${ok ? '✅' : '⚠️ '} ${descripcion} -- actual: ${JSON.stringify(actual)}${ok ? '' : `, esperado: ${JSON.stringify(esperado)}`}`);
  if (!ok) fallos++;
}

console.log('--- siguientePaso ---');

assertEq(
  'reserva vacía, negocio con 2+ servicios -> PEDIR_SERVICIO',
  siguientePaso(null, { hayAmbiguedadDeServicio: true, requiereRut: false }),
  PASOS.PEDIR_SERVICIO
);

assertEq(
  'reserva vacía, negocio con 0/1 servicio (sin ambigüedad) -> PEDIR_DIA directo, nunca PEDIR_SERVICIO',
  siguientePaso(null, { hayAmbiguedadDeServicio: false, requiereRut: false }),
  PASOS.PEDIR_DIA
);

assertEq(
  'servicio ya elegido, falta día -> PEDIR_DIA',
  siguientePaso({ servicioId: 's1' }, { hayAmbiguedadDeServicio: true, requiereRut: false }),
  PASOS.PEDIR_DIA
);

assertEq(
  'día y hora ya elegidos (bug real: no debe volver a pedir servicio ni mostrar horarios de nuevo) -> PEDIR_NOMBRE',
  siguientePaso({ servicioId: 's1', fecha: '2026-09-26', hora: '12:30' }, { hayAmbiguedadDeServicio: true, requiereRut: false }),
  PASOS.PEDIR_NOMBRE
);

assertEq(
  'todo listo, negocio sin RUT -> CONFIRMAR',
  siguientePaso({ servicioId: 's1', fecha: '2026-09-26', hora: '12:30', nombre: 'Rosa Levi' }, { hayAmbiguedadDeServicio: true, requiereRut: false }),
  PASOS.CONFIRMAR
);

assertEq(
  'nombre listo pero falta RUT, negocio que exige RUT -> PEDIR_RUT',
  siguientePaso({ servicioId: 's1', fecha: '2026-09-26', hora: '12:30', nombre: 'Rosa Levi' }, { hayAmbiguedadDeServicio: true, requiereRut: true }),
  PASOS.PEDIR_RUT
);

assertEq(
  'todo listo incluido RUT y teléfono -> CONFIRMAR',
  siguientePaso(
    { servicioId: 's1', fecha: '2026-09-26', hora: '12:30', nombre: 'Rosa Levi', rut: '12345678-9', telefonoContacto: '56911112222' },
    { hayAmbiguedadDeServicio: true, requiereRut: true }
  ),
  PASOS.CONFIRMAR
);

console.log('\n--- coincideConOpcionMostrada ---');

const opcionesHoras = [
  { valor: '09:15', etiquetas: ['09:15'] },
  { valor: '09:45', etiquetas: ['09:45'] },
];

assertEq(
  'texto exacto calza con una hora mostrada -> devuelve el valor',
  coincideConOpcionMostrada('09:15', opcionesHoras),
  '09:15'
);

assertEq(
  'texto con relleno normalizable ("¡09:45!") igual calza',
  coincideConOpcionMostrada('¡09:45!', opcionesHoras),
  '09:45'
);

assertEq(
  'texto ambiguo que NO calza con ninguna opción -> null (nunca se adivina)',
  coincideConOpcionMostrada('me da lo mismo cualquiera', opcionesHoras),
  null
);

assertEq(
  'sin opcionesMostradas (null) -> null, nunca revienta',
  coincideConOpcionMostrada('09:15', null),
  null
);

const opcionesServicios = [
  { valor: 'srv-1', etiquetas: ['Evaluación examen visual', 'evaluacion examen visual'] },
];
assertEq(
  'nombre exacto de servicio (con tilde) calza',
  coincideConOpcionMostrada('Evaluación examen visual', opcionesServicios),
  'srv-1'
);

console.log('\n--- PLANTILLAS_DETERMINISTAS ---');
assertEq(
  'cada paso tiene una plantilla fija no vacía',
  Object.values(PASOS).every((p) => typeof PLANTILLAS_DETERMINISTAS[p] === 'string' && PLANTILLAS_DETERMINISTAS[p].length > 0),
  true
);

console.log(`\n${fallos === 0 ? '✅' : '⚠️ '} ${fallos === 0 ? 'Todas las pruebas pasaron.' : `${fallos} fallo(s).`}`);
process.exitCode = fallos === 0 ? 0 : 1;
