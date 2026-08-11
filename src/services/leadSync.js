// src/services/leadSync.js
//
// Lógica compartida para mantener sincronizado el Lead (pool unificado de
// vendedores, ver prisma/schema.prisma y src/routes/leads.js) a partir de
// una DemoAsignada. Usado desde dos puntos:
//   - src/jobs/seguimientoDemo.js: crea/actualiza el Lead en el momento en
//     que la demo se deriva a vendedor (derivadoAVendedor: true).
//   - src/services/demoEngine.js: si el prospecto sigue escribiendo después
//     de ya estar derivado (en el pool o ya asignado a un vendedor), vuelve
//     a sincronizar el Lead para que el resumen/última interacción nunca
//     queden desactualizados.
//
// Vive acá (no dentro de seguimientoDemo.js) a propósito: seguimientoDemo.js
// se auto-ejecuta como script standalone al hacer require() (mismo patrón
// que confirmarCitasProximas.js) y desconecta el Prisma singleton al
// terminar — importarlo desde demoEngine.js dispararía el cron completo
// dentro del webhook y cortaría la conexión de Prisma de todo el server.
const prisma = require('../lib/prisma');

// historialSimulacion es un array de turnos { rol: 'prospecto' | 'asistente',
// texto: string } (ver demoEngine.js) — no un string concatenado. El resumen
// es el texto del último turno del prospecto, recortado a un extracto corto;
// no el historial completo.
const LARGO_MAXIMO_RESUMEN = 160;
function extraerResumenHistorial(historialSimulacion) {
  const historial = Array.isArray(historialSimulacion) ? historialSimulacion : [];
  const ultimoTurnoProspecto = [...historial].reverse().find((turno) => turno?.rol === 'prospecto' && turno?.texto);
  if (!ultimoTurnoProspecto) return null;

  const texto = String(ultimoTurnoProspecto.texto).trim();
  return texto.length > LARGO_MAXIMO_RESUMEN ? `${texto.slice(0, LARGO_MAXIMO_RESUMEN)}…` : texto;
}

// Crea o actualiza (upsert por origen+origenId, ver @@unique en el modelo
// Lead) el Lead correspondiente a esta demo. motivoDerivacion es opcional —
// solo se pasa en el momento de la derivación inicial; en sincronizaciones
// posteriores (demo ya derivada, prospecto sigue escribiendo) se omite para
// no pisar el motivo original con undefined.
async function sincronizarLeadDesdeDemo(demo, motivoDerivacion) {
  const datos = {
    telefono: demo.telefono,
    nombreProspecto: demo.nombreProspecto,
    intencionDetectada: demo.intencionPrecioDetectada,
    ultimoMensajeResumen: extraerResumenHistorial(demo.historialSimulacion),
    ultimaInteraccionEn: demo.ultimaInteraccionEn,
    ...(motivoDerivacion ? { motivoDerivacion } : {}),
  };

  await prisma.lead.upsert({
    where: { origen_origenId: { origen: 'whatsapp_demo', origenId: demo.id } },
    create: { origen: 'whatsapp_demo', origenId: demo.id, motivoDerivacion: motivoDerivacion ?? null, ...datos },
    update: datos,
  });
}

module.exports = { extraerResumenHistorial, sincronizarLeadDesdeDemo };
