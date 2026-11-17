#!/usr/bin/env node
// Uso puntual (17-nov-2026): llena de HISTORIAL DE EJEMPLO la demo de la Clínica
// del Dolor de Espalda (creada con _demo-clinica-dolor-espalda-17nov.js), para
// que el Dashboard y la Tabla de citas se vean con movimiento en la reunión del
// 18-nov 14:30:
//   - Citas de lunes a viernes desde el 01-jun-2026 hasta el 17-nov, en las 2
//     agendas, con crecimiento mes a mes (COMPLETADA / NO_ASISTIO / CANCELADA).
//   - Una Venta (monto de EJEMPLO, PAGADO) por cada cita COMPLETADA: alimenta el
//     monto del día y de la semana, el dinero por mes y las atenciones por tipo.
//   - 18-nov (día de la reunión): agenda llena; lo que es antes de las 14:00 queda
//     COMPLETADA con su venta; la tarde CONFIRMADA o PENDIENTE.
//   - 19 al 27-nov: más horas tomadas (PENDIENTE / CONFIRMADA).
// Los montos son de EJEMPLO, no precios reales de la clínica.
//
// Seguridad: solo toca la Empresa de la demo del 56984084321 (esDemo=true, sin
// WhatsApp propio, sin telefonoContacto). Pacientes con teléfonos fijos y
// obviamente falsos (56900000101-130). Ningún job envía nada a empresas sin
// whatsappNumeroId (ver auditoría del 17-nov en el script hermano).
// Reproducible: usa un generador pseudoaleatorio con semilla fija (mismo
// resultado cada vez). No se puede aplicar dos veces: aborta si ya hay ventas.
//
// USO (Shell de Render, producción):
//   node scripts/_demo-clinica-dolor-espalda-historial-17nov.js              # DRY-RUN
//   CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-historial-17nov.js  # aplica

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC } = require('../src/lib/horaChile');

const TELEFONO_DEMO = '56984084321';
const APLICAR = process.env.CONFIRMAR === '1';

const AGENDA_DAVID = 'David López · Quiropráctico';
const AGENDA_KINE = 'Kinesiología (equipo)';

// Monto de EJEMPLO por servicio (CLP).
const MONTOS = {
  Quiropraxia: 35000,
  'Tratamiento escoliosis': 45000,
  'Camilla hernia discal': 40000,
  Kinesiología: 25000,
  'Punción seca': 30000,
  'Electrólisis percutánea': 40000,
  'Terapia KineticXer': 30000,
  'Estudio de pisada': 45000,
};
// Peso de cada servicio dentro de su agenda (los más comunes salen más).
const MEZCLA = {
  [AGENDA_DAVID]: [['Quiropraxia', 6], ['Camilla hernia discal', 2], ['Tratamiento escoliosis', 1]],
  [AGENDA_KINE]: [['Kinesiología', 5], ['Punción seca', 3], ['Electrólisis percutánea', 2], ['Terapia KineticXer', 1], ['Estudio de pisada', 1]],
};
const ATENDIDO_POR = { [AGENDA_DAVID]: 'David López', [AGENDA_KINE]: 'Equipo de kinesiología' };
// Citas por día (mín, máx) en régimen; se escala por mes para mostrar crecimiento.
const CITAS_DIA = { [AGENDA_DAVID]: [7, 11], [AGENDA_KINE]: [6, 9] };
const FACTOR_MES = { '2026-06': 0.55, '2026-07': 0.62, '2026-08': 0.7, '2026-09': 0.78, '2026-10': 0.88, '2026-11': 1 };
const MEDIOS = [['TARJETA_DEBITO', 5], ['TARJETA_CREDITO', 3], ['TRANSFERENCIA', 3], ['EFECTIVO', 1]];

// Pacientes de EJEMPLO: teléfonos LITERALES, fijos y obviamente falsos.
// Los 12 primeros ya existen (los creó el script hermano).
const PACIENTES = [
  ['Camila Rojas', '56900000101'], ['Javier Muñoz', '56900000102'], ['Valentina Soto', '56900000103'],
  ['Matías González', '56900000104'], ['Francisca Díaz', '56900000105'], ['Felipe Contreras', '56900000106'],
  ['Antonia Silva', '56900000107'], ['Sebastián Morales', '56900000108'], ['Catalina Fuentes', '56900000109'],
  ['Diego Araya', '56900000110'], ['Josefa Castillo', '56900000111'], ['Tomás Reyes', '56900000112'],
  ['Martina Herrera', '56900000113'], ['Nicolás Vargas', '56900000114'], ['Isidora Pizarro', '56900000115'],
  ['Benjamín Torres', '56900000116'], ['Florencia Núñez', '56900000117'], ['Cristóbal Espinoza', '56900000118'],
  ['Javiera Molina', '56900000119'], ['Ignacio Sepúlveda', '56900000120'], ['Constanza Vega', '56900000121'],
  ['Joaquín Carrasco', '56900000122'], ['Daniela Bravo', '56900000123'], ['Vicente Riquelme', '56900000124'],
  ['Fernanda Tapia', '56900000125'], ['Agustín Cortés', '56900000126'], ['Paula Gutiérrez', '56900000127'],
  ['Maximiliano Álvarez', '56900000128'], ['Rocío Sandoval', '56900000129'], ['Gabriel Olivares', '56900000130'],
];

const DESDE = '2026-06-01';
const HASTA_HISTORIAL = '2026-11-17'; // inclusive: todo lo pasado
const DIA_REUNION = '2026-11-18';
const HORA_CORTE_REUNION = '14:00'; // antes de esto, el 18-nov ya está atendido
const HASTA_FUTURO = '2026-11-27';
const BLOQUES = [['09:00', '13:30'], ['15:00', '20:30']];

// ---- utilidades deterministas ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261118);
const entero = (min, max) => min + Math.floor(rnd() * (max - min + 1));
function ponderado(lista) {
  const total = lista.reduce((s, [, p]) => s + p, 0);
  let r = rnd() * total;
  for (const [v, p] of lista) { if ((r -= p) < 0) return v; }
  return lista[lista.length - 1][0];
}
const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const aHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
function diasHabiles(desde, hasta) {
  const out = [];
  for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function slotsDelDia(duracion) {
  const s = [];
  for (const [ini, fin] of BLOQUES) for (let m = aMin(ini); m + duracion <= aMin(fin); m += duracion) s.push(m);
  return s;
}
function elegirSlots(libres, n) {
  const copia = [...libres];
  for (let i = copia.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [copia[i], copia[j]] = [copia[j], copia[i]]; }
  return copia.slice(0, n).sort((a, b) => a - b);
}

async function main() {
  const demo = await prisma.demoAsignada.findUnique({
    where: { telefono: TELEFONO_DEMO },
    select: { id: true, empresaDemo: { select: { id: true, nombre: true, esDemo: true, whatsappNumeroId: true, telefonoContacto: true } } },
  });
  if (!demo) throw new Error(`No hay demo para ${TELEFONO_DEMO}.`);
  const empresa = demo.empresaDemo;
  if (!empresa.esDemo) throw new Error('La empresa NO es de demo: no se toca.');
  if (empresa.whatsappNumeroId) throw new Error('La empresa de demo tiene WhatsApp propio: no se toca.');
  if (empresa.telefonoContacto) throw new Error('La empresa de demo tiene telefonoContacto (el reset de contraseña le escribiría): no se toca.');
  const otras = await prisma.demoAsignada.count({ where: { empresaDemoId: empresa.id, NOT: { id: demo.id } } });
  if (otras > 0) throw new Error('La empresa de demo la comparte otra demo: no se toca.');
  const ventasPrevias = await prisma.venta.count({ where: { empresaId: empresa.id } });
  if (ventasPrevias > 0) throw new Error(`Ya hay ${ventasPrevias} ventas en esta demo: el historial ya se aplicó, no se duplica.`);

  const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: empresa.id, nombre: { in: [AGENDA_DAVID, AGENDA_KINE] } } });
  if (recursos.length !== 2) throw new Error('Faltan las 2 agendas: corre antes _demo-clinica-dolor-espalda-17nov.js.');
  const servicios = await prisma.servicio.findMany({ where: { empresaId: empresa.id, nombre: { in: Object.keys(MONTOS) } } });
  if (servicios.length !== Object.keys(MONTOS).length) throw new Error('Faltan servicios: corre antes _demo-clinica-dolor-espalda-17nov.js.');
  const servicioId = Object.fromEntries(servicios.map((s) => [s.nombre, s.id]));
  console.log(`Empresa "${empresa.nombre}" (${empresa.id}). ${APLICAR ? 'APLICANDO' : 'DRY-RUN (nada se escribe)'}`);

  // Pacientes (crea los que falten)
  const existentes = await prisma.cliente.findMany({ where: { empresaId: empresa.id, telefono: { in: PACIENTES.map((p) => p[1]) } }, select: { id: true, telefono: true } });
  const idPorTel = Object.fromEntries(existentes.map((c) => [c.telefono, c.id]));
  const faltan = PACIENTES.filter(([, t]) => !idPorTel[t]);
  console.log(`Pacientes: ${existentes.length} existentes, ${faltan.length} nuevos.`);
  if (APLICAR && faltan.length) {
    await prisma.cliente.createMany({ data: faltan.map(([nombre, telefono]) => ({ empresaId: empresa.id, nombre, telefono })) });
    const nuevos = await prisma.cliente.findMany({ where: { empresaId: empresa.id, telefono: { in: faltan.map((p) => p[1]) } }, select: { id: true, telefono: true } });
    for (const c of nuevos) idPorTel[c.telefono] = c.id;
  }

  // Citas existentes (las del script hermano): sus horas quedan ocupadas.
  const ocupadas = await prisma.cita.findMany({
    where: { empresaId: empresa.id },
    select: { id: true, recursoAgendableId: true, fechaHoraInicio: true, fechaHoraFin: true, estado: true, servicioId: true, clienteId: true, nombrePaciente: true },
  });

  const citasNuevas = [];
  const ventasNuevas = [];
  const pasarACompletada = [];
  const resumenMes = {};
  const servicioNombrePorId = Object.fromEntries(servicios.map((s) => [s.id, s.nombre]));

  function venta({ recurso, clienteId, nombreServ, fin }) {
    ventasNuevas.push({
      empresaId: empresa.id,
      clienteId,
      descripcion: nombreServ,
      monto: MONTOS[nombreServ],
      estadoPago: 'PAGADO',
      medioPago: ponderado(MEDIOS),
      categoriaProducto: nombreServ,
      servicioId: servicioId[nombreServ],
      recursoAgendableId: recurso.id,
      atendidoPor: ATENDIDO_POR[recurso.nombre],
      fecha: fin,
    });
  }

  const todosLosDias = diasHabiles(DESDE, HASTA_FUTURO);
  for (const fecha of todosLosDias) {
    const mes = fecha.slice(0, 7);
    const esPasado = fecha <= HASTA_HISTORIAL;
    const esReunion = fecha === DIA_REUNION;
    for (const recurso of recursos) {
      const dur = recurso.duracionCitaMinutos;
      const ocupadasDia = ocupadas.filter((c) => c.recursoAgendableId === recurso.id && c.fechaHoraInicio >= horaChileAFechaUTC(fecha, '00:00') && c.fechaHoraInicio <= horaChileAFechaUTC(fecha, '23:59'));
      const libres = slotsDelDia(dur).filter((m) => {
        const ini = horaChileAFechaUTC(fecha, aHHMM(m)).getTime();
        const fin = ini + dur * 60000;
        return !ocupadasDia.some((c) => ini < c.fechaHoraFin.getTime() && fin > c.fechaHoraInicio.getTime());
      });
      const [mn, mx] = CITAS_DIA[recurso.nombre];
      let n;
      if (esPasado) n = Math.round(entero(mn, mx) * (FACTOR_MES[mes] || 1));
      else if (esReunion) n = Math.max(0, mx + 1 - ocupadasDia.length);
      else n = Math.max(0, entero(Math.round(mn * 0.5), mx - 2) - ocupadasDia.length);

      for (const m of elegirSlots(libres, n)) {
        const hora = aHHMM(m);
        const ini = horaChileAFechaUTC(fecha, hora);
        const fin = new Date(ini.getTime() + dur * 60000);
        const [nombrePac, tel] = PACIENTES[entero(0, PACIENTES.length - 1)];
        const nombreServ = ponderado(MEZCLA[recurso.nombre]);
        let estado;
        if (esPasado || (esReunion && hora < HORA_CORTE_REUNION)) {
          estado = ponderado([['COMPLETADA', 85], ['NO_ASISTIO', 7], ['CANCELADA', 8]]);
        } else {
          estado = ponderado(esReunion ? [['CONFIRMADA', 3], ['PENDIENTE', 1]] : [['PENDIENTE', 3], ['CONFIRMADA', 2]]);
        }
        citasNuevas.push({
          empresaId: empresa.id, clienteId: tel, recursoAgendableId: recurso.id, servicioId: servicioId[nombreServ],
          fechaHoraInicio: ini, fechaHoraFin: fin, estado, origenCanal: rnd() < 0.7 ? 'whatsapp' : 'panel', nombrePaciente: nombrePac,
        });
        if (estado === 'COMPLETADA') venta({ recurso, clienteId: tel, nombreServ, fin });
        resumenMes[mes] = resumenMes[mes] || { citas: 0, ventas: 0, monto: 0 };
        resumenMes[mes].citas++;
        if (estado === 'COMPLETADA') { resumenMes[mes].ventas++; resumenMes[mes].monto += MONTOS[nombreServ]; }
      }

      // Las citas del script hermano del 18-nov antes de las 14:00 pasan a COMPLETADA con su venta.
      if (esReunion) {
        resumenMes[mes] = resumenMes[mes] || { citas: 0, ventas: 0, monto: 0 };
        for (const c of ocupadasDia) {
          const horaC = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(c.fechaHoraInicio);
          if (horaC < HORA_CORTE_REUNION && c.estado !== 'COMPLETADA') {
            pasarACompletada.push(c.id);
            const nombreServ = servicioNombrePorId[c.servicioId];
            ventasNuevas.push({
              empresaId: empresa.id, clienteId: c.clienteId, descripcion: nombreServ, monto: MONTOS[nombreServ], estadoPago: 'PAGADO',
              medioPago: ponderado(MEDIOS), categoriaProducto: nombreServ, servicioId: c.servicioId, recursoAgendableId: recurso.id,
              atendidoPor: ATENDIDO_POR[recurso.nombre], fecha: c.fechaHoraFin, _yaConId: true,
            });
            resumenMes[mes].ventas++; resumenMes[mes].monto += MONTOS[nombreServ];
          }
        }
      }
    }
  }

  console.log('Resumen por mes (citas nuevas / ventas / monto de ejemplo):');
  for (const [mes, r] of Object.entries(resumenMes)) console.log(`  ${mes}: ${r.citas} citas, ${r.ventas} ventas, $${r.monto.toLocaleString('es-CL')}`);
  const reunion = citasNuevas.filter((c) => c.fechaHoraInicio >= horaChileAFechaUTC(DIA_REUNION, '00:00') && c.fechaHoraInicio <= horaChileAFechaUTC(DIA_REUNION, '23:59'));
  const montoReunion = ventasNuevas.filter((v) => v.fecha >= horaChileAFechaUTC(DIA_REUNION, '00:00') && v.fecha <= horaChileAFechaUTC(DIA_REUNION, '23:59')).reduce((s, v) => s + v.monto, 0);
  console.log(`18-nov: ${reunion.length} citas nuevas + ${pasarACompletada.length} existentes pasan a COMPLETADA; monto del día $${montoReunion.toLocaleString('es-CL')}.`);
  console.log(`TOTAL: ${citasNuevas.length} citas nuevas, ${ventasNuevas.length} ventas.`);

  if (!APLICAR) {
    console.log('\nNada se escribió. Para aplicar: CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-historial-17nov.js');
    return;
  }

  // Resolver teléfonos → id de cliente y escribir en lotes.
  const citasData = citasNuevas.map((c) => ({ ...c, clienteId: idPorTel[c.clienteId] }));
  const ventasData = ventasNuevas.map(({ _yaConId, ...v }) => (_yaConId ? v : { ...v, clienteId: idPorTel[v.clienteId] }));
  if (citasData.some((c) => !c.clienteId) || ventasData.some((v) => !v.clienteId)) throw new Error('Paciente sin id: no se escribe nada más.');

  for (let i = 0; i < citasData.length; i += 500) await prisma.cita.createMany({ data: citasData.slice(i, i + 500) });
  console.log(`✅ ${citasData.length} citas creadas.`);
  if (pasarACompletada.length) await prisma.cita.updateMany({ where: { id: { in: pasarACompletada }, empresaId: empresa.id }, data: { estado: 'COMPLETADA' } });
  for (let i = 0; i < ventasData.length; i += 500) await prisma.venta.createMany({ data: ventasData.slice(i, i + 500) });
  console.log(`✅ ${ventasData.length} ventas creadas. ✅ Listo.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
