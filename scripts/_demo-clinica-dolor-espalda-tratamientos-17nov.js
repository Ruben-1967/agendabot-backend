#!/usr/bin/env node
// Uso puntual (17-nov-2026): REHACE el historial de ejemplo de la demo de la
// Clínica del Dolor de Espalda como TRATAMIENTOS realistas (pedido de Rubén):
//   - 90 pacientes de ejemplo; cada uno viene 1 vez por semana (≈4 citas al mes),
//     siempre el mismo día y a una hora parecida, con su agenda y su servicio.
//   - Tratamientos de 3 a 5 meses; algunos recién empezaron y otros llevan ~6
//     meses (desde junio). Valor promedio por cita ≈ $35.000 (montos de EJEMPLO).
//   - Pasado: COMPLETADA (con su venta) / NO_ASISTIO / CANCELADA.
//   - Hoy 17-nov y mañana 18-nov (reunión): todas confirmadas o atendidas salvo
//     2 PENDIENTE por día; lo atendido (antes de la hora de corte) con su venta.
//   - 19 al 27-nov: las sesiones que siguen de los tratamientos activos.
//   - Cliente.fechaProximaCita = su próxima cita (la lista de pacientes la muestra).
//
// Antes BORRA todas las citas y ventas de ESTA empresa de demo. Aborta si alguna
// es de un paciente que no sea de ejemplo (teléfonos 569000001xx), para no tocar
// nunca datos reales. Mismos resguardos que _demo-clinica-dolor-espalda-17nov.js
// (esDemo, sin WhatsApp propio, sin telefonoContacto, demo no compartida).
// Generador con semilla fija: el resultado es siempre el mismo.
//
// USO (Shell de Render, producción):
//   node scripts/_demo-clinica-dolor-espalda-tratamientos-17nov.js              # DRY-RUN
//   CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-tratamientos-17nov.js  # aplica

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC } = require('../src/lib/horaChile');

const TELEFONO_DEMO = '56984084321';
const APLICAR = process.env.CONFIRMAR === '1';
const PATRON_TEL_EJEMPLO = /^569000001\d\d$/;

const AGENDA_DAVID = 'David López · Quiropráctico';
const AGENDA_KINE = 'Kinesiología (equipo)';
const ATENDIDO_POR = { [AGENDA_DAVID]: 'David López', [AGENDA_KINE]: 'Equipo de kinesiología' };

// Monto de EJEMPLO por sesión (promedio ≈ $35.000).
const MONTOS = {
  Quiropraxia: 35000,
  'Tratamiento escoliosis': 40000,
  'Camilla hernia discal': 38000,
  Kinesiología: 30000,
  'Punción seca': 35000,
  'Electrólisis percutánea': 40000,
  'Terapia KineticXer': 35000,
  'Estudio de pisada': 45000,
};
// Tratamiento principal de cada paciente, según su agenda (peso).
const TRATAMIENTOS = {
  [AGENDA_DAVID]: [['Quiropraxia', 6], ['Camilla hernia discal', 3], ['Tratamiento escoliosis', 2]],
  [AGENDA_KINE]: [['Kinesiología', 6], ['Punción seca', 3], ['Electrólisis percutánea', 2], ['Terapia KineticXer', 2]],
};
const MEDIOS = [['TARJETA_DEBITO', 5], ['TARJETA_CREDITO', 3], ['TRANSFERENCIA', 3], ['EFECTIVO', 1]];

// Pacientes de EJEMPLO: teléfonos LITERALES, fijos y obviamente falsos.
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
  ['Carolina Figueroa', '56900000131'], ['Rodrigo Jara', '56900000132'], ['Macarena Valenzuela', '56900000133'],
  ['Andrés Rivera', '56900000134'], ['Bárbara Flores', '56900000135'], ['Pablo Pérez', '56900000136'],
  ['Carla López', '56900000137'], ['Gonzalo Fernández', '56900000138'], ['Natalia Ramírez', '56900000139'],
  ['Claudio Gómez', '56900000140'], ['Verónica Cáceres', '56900000141'], ['Patricio Salazar', '56900000142'],
  ['Lorena Orellana', '56900000143'], ['Mauricio Vidal', '56900000144'], ['Paola Lagos', '56900000145'],
  ['Eduardo Toro', '56900000146'], ['Marcela Poblete', '56900000147'], ['Ricardo Ortiz', '56900000148'],
  ['Gloria Peña', '56900000149'], ['Jorge Ibarra', '56900000150'], ['Sandra Campos', '56900000151'],
  ['Luis Zúñiga', '56900000152'], ['Ximena Navarro', '56900000153'], ['Hernán Medina', '56900000154'],
  ['Cecilia Alarcón', '56900000155'], ['Raúl Aguilera', '56900000156'], ['Mónica Leiva', '56900000157'],
  ['Sergio Garrido', '56900000158'], ['Alejandra Bustos', '56900000159'], ['Juan Pablo Cárdenas', '56900000160'],
  ['Teresa Mella', '56900000161'], ['Fernando Guerrero', '56900000162'], ['Silvia Saavedra', '56900000163'],
  ['Alberto Parra', '56900000164'], ['Rosa Hidalgo', '56900000165'], ['Manuel Escobar', '56900000166'],
  ['Elena Miranda', '56900000167'], ['Óscar Rubio', '56900000168'], ['Pilar Vera', '56900000169'],
  ['Arturo Acuña', '56900000170'], ['Viviana Osorio', '56900000171'], ['Héctor Palma', '56900000172'],
  ['Soledad Moya', '56900000173'], ['Marcelo Sáez', '56900000174'], ['Angélica Farías', '56900000175'],
  ['René Henríquez', '56900000176'], ['Beatriz Carvajal', '56900000177'], ['Iván Donoso', '56900000178'],
  ['Susana Paredes', '56900000179'], ['Leonardo Arancibia', '56900000180'], ['Gabriela Maldonado', '56900000181'],
  ['Cristián Venegas', '56900000182'], ['Valeria Ruiz', '56900000183'], ['Esteban Lillo', '56900000184'],
  ['Margarita Quiroz', '56900000185'], ['Rubén Correa', '56900000186'], ['Tamara Gallardo', '56900000187'],
  ['Álvaro Cifuentes', '56900000188'], ['Lucía Rosales', '56900000189'], ['Emilio Valdés', '56900000190'],
];

const INICIO_HISTORIAL = '2026-06-01';
const HOY = '2026-11-17';
const DIA_REUNION = '2026-11-18';
const HORA_CORTE = { [HOY]: '16:00', [DIA_REUNION]: '14:00' }; // antes de esto: ya atendido
const FIN_FUTURO = '2026-11-27';
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
const rnd = mulberry32(20261117);
const entero = (min, max) => min + Math.floor(rnd() * (max - min + 1));
function ponderado(lista) {
  const total = lista.reduce((s, [, p]) => s + p, 0);
  let r = rnd() * total;
  for (const [v, p] of lista) { if ((r -= p) < 0) return v; }
  return lista[lista.length - 1][0];
}
const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const aHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const sumarDias = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function slotsDelDia(duracion) {
  const s = [];
  for (const [ini, fin] of BLOQUES) for (let m = aMin(ini); m + duracion <= aMin(fin); m += duracion) s.push(m);
  return s;
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
  if (empresa.telefonoContacto) throw new Error('La empresa de demo tiene telefonoContacto: no se toca.');
  const otras = await prisma.demoAsignada.count({ where: { empresaDemoId: empresa.id, NOT: { id: demo.id } } });
  if (otras > 0) throw new Error('La empresa de demo la comparte otra demo: no se toca.');

  // Solo se borra si TODO es de pacientes de ejemplo.
  const ajenasCitas = await prisma.cita.count({ where: { empresaId: empresa.id, NOT: { cliente: { telefono: { startsWith: '569000001' } } } } });
  const ajenasVentas = await prisma.venta.count({ where: { empresaId: empresa.id, NOT: { cliente: { telefono: { startsWith: '569000001' } } } } });
  if (ajenasCitas || ajenasVentas) throw new Error(`Hay ${ajenasCitas} citas y ${ajenasVentas} ventas de pacientes que no son de ejemplo: no se borra nada.`);
  if (!PACIENTES.every(([, t]) => PATRON_TEL_EJEMPLO.test(t))) throw new Error('Algún teléfono de ejemplo no calza con el patrón 569000001xx.');

  const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: empresa.id, nombre: { in: [AGENDA_DAVID, AGENDA_KINE] } } });
  if (recursos.length !== 2) throw new Error('Faltan las 2 agendas: corre antes _demo-clinica-dolor-espalda-17nov.js.');
  const servicios = await prisma.servicio.findMany({ where: { empresaId: empresa.id, nombre: { in: Object.keys(MONTOS) } } });
  if (servicios.length !== Object.keys(MONTOS).length) throw new Error('Faltan servicios.');
  const servicioId = Object.fromEntries(servicios.map((s) => [s.nombre, s.id]));
  const recursoPorNombre = Object.fromEntries(recursos.map((r) => [r.nombre, r]));

  const [citasAntes, ventasAntes] = await Promise.all([
    prisma.cita.count({ where: { empresaId: empresa.id } }),
    prisma.venta.count({ where: { empresaId: empresa.id } }),
  ]);
  console.log(`Empresa "${empresa.nombre}" (${empresa.id}). ${APLICAR ? 'APLICANDO' : 'DRY-RUN (nada se escribe)'}`);
  console.log(`Se borran ${citasAntes} citas y ${ventasAntes} ventas de ejemplo actuales.`);

  // ---- 1. Plan de tratamiento de cada paciente ----
  // Inicio repartido entre jun y nov, con más pacientes nuevos hacia el final
  // (la clínica crece). Duración 3-5 meses; los que empezaron en junio y
  // "siguen" llevan ~6 meses.
  const planes = PACIENTES.map(([nombre, tel], i) => {
    const agenda = i % 5 < 3 ? AGENDA_KINE : AGENDA_DAVID; // 60% kine, 40% David
    const servicio = ponderado(TRATAMIENTOS[agenda]);
    const offsetInicio = Math.floor(Math.pow(rnd(), 0.8) * 150); // algo sesgado hacia fechas recientes
    let inicio = sumarDias(INICIO_HISTORIAL, offsetInicio);
    const largos = i < 10; // algunos llevan ~6 meses
    if (largos) inicio = sumarDias(INICIO_HISTORIAL, entero(0, 10));
    const semanas = largos ? 30 : entero(13, 22); // 3 a 5 meses
    const dow = entero(1, 5);
    const horaPreferida = slotsDelDia(recursoPorNombre[agenda].duracionCitaMinutos)[entero(0, 10)];
    return { nombre, tel, agenda, servicio, inicio, semanas, dow, horaPreferida };
  });

  // ---- 2. Generar sesiones semanales, sin choques de horario ----
  const ocupado = new Map(); // `${recursoId}|${fecha}` -> Set(minuto inicio)
  const citas = [];
  for (const p of planes) {
    const recurso = recursoPorNombre[p.agenda];
    const dur = recurso.duracionCitaMinutos;
    const slots = slotsDelDia(dur);
    // primera fecha en su día de la semana, desde el inicio
    let fecha = p.inicio;
    while (diaSemana(fecha) !== p.dow) fecha = sumarDias(fecha, 1);
    for (let k = 0; k < p.semanas && fecha <= FIN_FUTURO; k++, fecha = sumarDias(fecha, 7)) {
      const clave = `${recurso.id}|${fecha}`;
      if (!ocupado.has(clave)) ocupado.set(clave, new Set());
      const set = ocupado.get(clave);
      // hora preferida o la más cercana libre
      const candidatos = [...slots].sort((a, b) => Math.abs(a - p.horaPreferida) - Math.abs(b - p.horaPreferida));
      const m = candidatos.find((x) => !set.has(x));
      if (m === undefined) continue;
      set.add(m);
      // a veces la sesión es de otro servicio de la misma agenda (control, estudio de pisada)
      const nombreServ = rnd() < 0.12
        ? (p.agenda === AGENDA_KINE ? 'Estudio de pisada' : ponderado(TRATAMIENTOS[AGENDA_DAVID]))
        : p.servicio;
      citas.push({ p, recurso, fecha, hora: aHHMM(m), dur, nombreServ });
    }
  }

  // ---- 3. Estados y ventas ----
  const citasData = [];
  const ventasData = [];
  const pendientesPorDia = { [HOY]: 0, [DIA_REUNION]: 0 };
  citas.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  for (const c of citas) {
    const ini = horaChileAFechaUTC(c.fecha, c.hora);
    const fin = new Date(ini.getTime() + c.dur * 60000);
    let estado;
    if (c.fecha < HOY) {
      estado = ponderado([['COMPLETADA', 88], ['NO_ASISTIO', 6], ['CANCELADA', 6]]);
    } else if (c.fecha === HOY || c.fecha === DIA_REUNION) {
      // Todas confirmadas o atendidas, salvo 2 pendientes de la tarde.
      const atendida = c.hora < HORA_CORTE[c.fecha];
      if (!atendida && c.hora >= '15:00' && pendientesPorDia[c.fecha] < 2 && rnd() < 0.4) {
        estado = 'PENDIENTE';
        pendientesPorDia[c.fecha]++;
      } else {
        estado = atendida ? 'COMPLETADA' : 'CONFIRMADA';
      }
    } else {
      estado = ponderado([['CONFIRMADA', 2], ['PENDIENTE', 3]]);
    }
    citasData.push({
      empresaId: empresa.id, clienteTel: c.p.tel, recursoAgendableId: c.recurso.id, servicioId: servicioId[c.nombreServ],
      fechaHoraInicio: ini, fechaHoraFin: fin, estado, origenCanal: rnd() < 0.7 ? 'whatsapp' : 'panel', nombrePaciente: c.p.nombre,
    });
    if (estado === 'COMPLETADA') {
      ventasData.push({
        empresaId: empresa.id, clienteTel: c.p.tel, descripcion: c.nombreServ, monto: MONTOS[c.nombreServ], estadoPago: 'PAGADO',
        medioPago: ponderado(MEDIOS), categoriaProducto: c.nombreServ, servicioId: servicioId[c.nombreServ],
        recursoAgendableId: c.recurso.id, atendidoPor: ATENDIDO_POR[c.recurso.nombre], fecha: fin,
      });
    }
  }
  // Si algún día quedó sin sus 2 pendientes (pocas citas de tarde), se marcan las últimas de la tarde.
  for (const dia of [HOY, DIA_REUNION]) {
    const delDia = citasData.filter((c) => c.fechaHoraInicio >= horaChileAFechaUTC(dia, '00:00') && c.fechaHoraInicio <= horaChileAFechaUTC(dia, '23:59'));
    for (const c of delDia.filter((x) => x.estado === 'CONFIRMADA').reverse()) {
      if (pendientesPorDia[dia] >= 2) break;
      c.estado = 'PENDIENTE'; pendientesPorDia[dia]++;
    }
  }

  // ---- 4. Resumen ----
  const total = {}; const visitas = {};
  for (const v of ventasData) { total[v.clienteTel] = (total[v.clienteTel] || 0) + v.monto; visitas[v.clienteTel] = (visitas[v.clienteTel] || 0) + 1; }
  const montos = Object.values(total).sort((a, b) => a - b);
  const porMes = {};
  for (const c of citasData) { const m = c.fechaHoraInicio.toISOString().slice(0, 7); porMes[m] = porMes[m] || { citas: 0, monto: 0 }; porMes[m].citas++; }
  for (const v of ventasData) { const m = v.fecha.toISOString().slice(0, 7); porMes[m].monto += v.monto; }
  console.log('Por mes (citas / monto de ejemplo):');
  for (const [m, r] of Object.entries(porMes)) console.log(`  ${m}: ${r.citas} citas, $${r.monto.toLocaleString('es-CL')}`);
  const conteoDia = (dia) => {
    const d = citasData.filter((c) => c.fechaHoraInicio >= horaChileAFechaUTC(dia, '00:00') && c.fechaHoraInicio <= horaChileAFechaUTC(dia, '23:59'));
    const e = d.reduce((acc, c) => ((acc[c.estado] = (acc[c.estado] || 0) + 1), acc), {});
    const monto = ventasData.filter((v) => v.fecha >= horaChileAFechaUTC(dia, '00:00') && v.fecha <= horaChileAFechaUTC(dia, '23:59')).reduce((s, v) => s + v.monto, 0);
    return `${d.length} citas ${JSON.stringify(e)}, monto $${monto.toLocaleString('es-CL')}`;
  };
  console.log(`Hoy ${HOY}: ${conteoDia(HOY)}`);
  console.log(`Reunión ${DIA_REUNION}: ${conteoDia(DIA_REUNION)}`);
  const prom = Math.round(ventasData.reduce((s, v) => s + v.monto, 0) / ventasData.length);
  console.log(`Pacientes con atenciones: ${montos.length}. Total por paciente: mín $${montos[0].toLocaleString('es-CL')}, mediana $${montos[Math.floor(montos.length / 2)].toLocaleString('es-CL')}, máx $${montos[montos.length - 1].toLocaleString('es-CL')}. Valor promedio por cita: $${prom.toLocaleString('es-CL')}.`);
  console.log(`TOTAL: ${citasData.length} citas, ${ventasData.length} ventas.`);

  if (!APLICAR) {
    console.log('\nNada se escribió. Para aplicar: CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-tratamientos-17nov.js');
    return;
  }

  // ---- 5. Escribir ----
  const existentes = await prisma.cliente.findMany({ where: { empresaId: empresa.id, telefono: { in: PACIENTES.map((p) => p[1]) } }, select: { id: true, telefono: true } });
  const idPorTel = Object.fromEntries(existentes.map((c) => [c.telefono, c.id]));
  const faltan = PACIENTES.filter(([, t]) => !idPorTel[t]);
  if (faltan.length) {
    await prisma.cliente.createMany({ data: faltan.map(([nombre, telefono]) => ({ empresaId: empresa.id, nombre, telefono })) });
    const nuevos = await prisma.cliente.findMany({ where: { empresaId: empresa.id, telefono: { in: faltan.map((p) => p[1]) } }, select: { id: true, telefono: true } });
    for (const c of nuevos) idPorTel[c.telefono] = c.id;
  }
  console.log(`Pacientes: ${existentes.length} existentes, ${faltan.length} nuevos.`);

  await prisma.venta.deleteMany({ where: { empresaId: empresa.id } });
  await prisma.cita.deleteMany({ where: { empresaId: empresa.id } });
  console.log('Historial anterior borrado.');

  const citasFinal = citasData.map(({ clienteTel, ...c }) => ({ ...c, clienteId: idPorTel[clienteTel] }));
  const ventasFinal = ventasData.map(({ clienteTel, ...v }) => ({ ...v, clienteId: idPorTel[clienteTel] }));
  for (let i = 0; i < citasFinal.length; i += 500) await prisma.cita.createMany({ data: citasFinal.slice(i, i + 500) });
  for (let i = 0; i < ventasFinal.length; i += 500) await prisma.venta.createMany({ data: ventasFinal.slice(i, i + 500) });
  console.log(`✅ ${citasFinal.length} citas y ${ventasFinal.length} ventas creadas.`);

  // Próxima cita de cada paciente (se ve en la lista de pacientes).
  const ahora = horaChileAFechaUTC(DIA_REUNION, '00:00');
  for (const [, tel] of PACIENTES) {
    const proxima = citasFinal.filter((c) => c.clienteId === idPorTel[tel] && c.fechaHoraInicio >= ahora && c.estado !== 'CANCELADA')
      .sort((a, b) => a.fechaHoraInicio - b.fechaHoraInicio)[0];
    await prisma.cliente.update({ where: { id: idPorTel[tel] }, data: { fechaProximaCita: proxima ? proxima.fechaHoraInicio : null }, select: { id: true } });
  }
  console.log('✅ Próxima cita de cada paciente actualizada. ✅ Listo.');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
