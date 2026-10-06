#!/usr/bin/env node
// Prueba unitaria (sin base de datos, sin WhatsApp) de la detección de
// "iré / asistiré / ahí estaré" -- src/lib/respuestaAsistencia.js. Los casos
// negativos incluyen los falsos positivos que encontró la revisión de código
// del 2026-10-06 ("voy a pensarlo", "estaré de vacaciones", "iré a otra
// óptica"...).
//
// USO: node scripts/_probar-respuesta-asistencia-06oct.js

const { esConfirmacionDeAsistencia, mencionaFechaOHoraConcreta } = require('../src/lib/respuestaAsistencia');

const DEBE_SER_ASISTENCIA = [
  'Ok mañna iré', 'ok mañana iré', 'Ahí estaré', 'ahi estare!', 'Nos vemos mañana', 'nos vemos', 'Sí, asistiré', 'Asistiré, gracias',
  'Voy sin falta', 'ya voy', 'Voy para allá', 'Perfecto, ahí estaremos', 'Cuenten conmigo', 'Confirmado', 'Confirmo mi asistencia',
  'Estaré ahí', 'iréee', 'Llegaré a la hora', 'Gracias, nos vemos mañana', 'Listo, voy mañana', 'Ahí voy 👍', 'Estoy ahí a las 10',
  'Paso mañana', 'Ok, voy a asistir', 'dale ahi estare', 'Si iré', 'Gracias! Ahí estaremos', 'Allá nos vemos', 'Voy a ir', 'Estaré',
  'Sí, voy a estar', 'Ahí nos veremos', 'Vamos a ir los dos', 'Ok voy para allá mañana',
];

const NO_DEBE_SER_ASISTENCIA = [
  'No iré', 'No puedo ir', 'No voy a poder', 'no alcanzo a llegar', '¿Voy mañana?', '¿A qué hora era?', 'Quiero cambiar la hora',
  'Voy pero llegaré tarde y quiero otra hora', 'Puedo ir mañana?', 'No creo que vaya', 'Hola', 'Gracias', 'Perfecto',
  'Quiero agendar una hora', 'voy a cancelar', 'Ahora no puedo, iré otro día', 'Necesito reagendar, no iré',
  'cuanto cuesta, voy mañana', 'iré el sábado pero mejor otro día',
  'Hola, quisiera cotizar lentes, voy mañana al local en la tarde para ver modelos y precios por favor',
  'voy a pensarlo', 'voy a ver', 'voy a consultar con mi esposo', 'voy a averiguar', 'lo tendré presente', 'vamos viendo',
  'me voy a otro lado', 'iré a otra óptica', 'estaré de vacaciones', 'estaré de viaje', 'estaré fuera', 'estaré ocupado mañana',
  'Voy', 'Vamos', 'voy a evaluarlo', 'lamentablemente estaré fuera', 'voy a ver si puedo',
];

// Mensajes que SÍ expresan asistencia pero nombran un día/hora concreta: el
// servidor no los confirma a ciegas (pueden ser un cambio de hora).
const CON_FECHA_U_HORA = ['iré el lunes en vez del martes', 'voy a las 5', 'ire a las 4', 'iré el sábado', 'ahí estaré a las 10', 'iré el 17'];
const SIN_FECHA_NI_HORA = ['Ok mañana iré', 'Ahí estaré', 'nos vemos', 'Confirmado'];

let fallas = 0;
for (const t of DEBE_SER_ASISTENCIA) if (!esConfirmacionDeAsistencia(t)) { fallas++; console.log(`⚠️  Debía ser asistencia: "${t}"`); }
for (const t of NO_DEBE_SER_ASISTENCIA) if (esConfirmacionDeAsistencia(t)) { fallas++; console.log(`⚠️  NO debía ser asistencia: "${t}"`); }
for (const t of CON_FECHA_U_HORA) if (!mencionaFechaOHoraConcreta(t)) { fallas++; console.log(`⚠️  Debía detectar fecha/hora: "${t}"`); }
for (const t of SIN_FECHA_NI_HORA) if (mencionaFechaOHoraConcreta(t)) { fallas++; console.log(`⚠️  NO debía detectar fecha/hora: "${t}"`); }

const total = DEBE_SER_ASISTENCIA.length + NO_DEBE_SER_ASISTENCIA.length + CON_FECHA_U_HORA.length + SIN_FECHA_NI_HORA.length;
console.log(fallas === 0 ? `✅ ${total} casos OK` : `❌ ${fallas} de ${total} casos fallaron`);
process.exitCode = fallas === 0 ? 0 : 1;
