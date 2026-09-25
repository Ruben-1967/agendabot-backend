#!/usr/bin/env node
// Uso puntual: diagnosticar por qué el recordatorio no muestra el día de la
// semana pese a que el código ya pide weekday:'long' -- puede ser que el
// build de Node en Render no tenga soporte ICU completo para es-CL. Solo
// imprime, no toca nada.
//
// USO (Shell de Render, producción):
//   node scripts/_probar-locale-dia-semana-25sep.js

const fecha = new Date('2026-09-30T14:00:00Z');
console.log('Node version:', process.version);
console.log('ICU disponible:', typeof Intl === 'object' ? 'sí' : 'no');
console.log('Locales soportados por Intl.DateTimeFormat("es-CL"):', Intl.DateTimeFormat.supportedLocalesOf(['es-CL']));
console.log('Resultado weekday:long:', fecha.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }));
console.log('Resultado sin weekday (control):', fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' }));
