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
const { fechaISOEnChile } = require('../lib/horaChile');

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

// Cuenta días de calendario (hora Chile) distintos con interacción, no
// mensajes — si el lead ya existe y su ultimoDiaInteraccion cae en el mismo
// día que instanteInteraccion, el contador no avanza; si cae en un día
// distinto (o es la primera vez), avanza en 1. instanteInteraccion es el
// momento real del mensaje del prospecto (demo.ultimaInteraccionEn), no el
// momento en que corre este código — importante porque un reintento tardío
// o un cron no deben decidir el día por su propio reloj. leadExistente es
// null en la primerísima interacción (el Lead todavía no existe) — ahí el
// default de schema (1) ya es el valor correcto.
async function calcularDiasInteraccion(origenId, instanteInteraccion) {
  const leadExistente = await prisma.lead.findUnique({
    where: { origen_origenId: { origen: 'whatsapp_demo', origenId } },
    select: { diasInteraccion: true, ultimoDiaInteraccion: true },
  });

  if (!leadExistente) return 1;

  const fechaInteraccion = fechaISOEnChile(instanteInteraccion);
  const fechaUltimaPrevia = leadExistente.ultimoDiaInteraccion ? fechaISOEnChile(leadExistente.ultimoDiaInteraccion) : null;
  return fechaUltimaPrevia === fechaInteraccion ? leadExistente.diasInteraccion : leadExistente.diasInteraccion + 1;
}

// Crea o actualiza (upsert por origen+origenId, ver @@unique en el modelo
// Lead) el Lead correspondiente a esta demo. motivoDerivacion es opcional —
// solo se pasa en el momento de la derivación inicial; en sincronizaciones
// posteriores (demo ya derivada, prospecto sigue escribiendo) se omite para
// no pisar el motivo original con undefined. rubro es opcional por el mismo
// motivo, pero además no cambia en la vida de la demo — solo hace falta
// pasarlo la primera vez (ver server.js, punto de creación de la demo), ya
// que un upsert sin el campo no lo toca.
async function sincronizarLeadDesdeDemo(demo, motivoDerivacion, rubro) {
  // Al crear la demo, ultimaInteraccionEn todavía es null (se escribe recién
  // en el primer turno procesado por demoEngine.js) — ahí "ahora" sí es el
  // instante real de la interacción.
  const instanteInteraccion = demo.ultimaInteraccionEn || new Date();

  const datos = {
    telefono: demo.telefono,
    nombreProspecto: demo.nombreProspecto,
    intencionDetectada: demo.intencionPrecioDetectada,
    ultimoMensajeResumen: extraerResumenHistorial(demo.historialSimulacion),
    ultimaInteraccionEn: demo.ultimaInteraccionEn,
    diasInteraccion: await calcularDiasInteraccion(demo.id, instanteInteraccion),
    ultimoDiaInteraccion: instanteInteraccion,
    ...(motivoDerivacion ? { motivoDerivacion } : {}),
    ...(rubro ? { rubro } : {}),
  };

  await prisma.lead.upsert({
    where: { origen_origenId: { origen: 'whatsapp_demo', origenId: demo.id } },
    create: { origen: 'whatsapp_demo', origenId: demo.id, motivoDerivacion: motivoDerivacion ?? null, ...datos },
    update: datos,
  });
}

module.exports = { extraerResumenHistorial, sincronizarLeadDesdeDemo };
