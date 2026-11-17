#!/usr/bin/env node
// Uso puntual (17-nov-2026), pedido de Rubén para la reunión con la Clínica del
// Dolor de Espalda:
//
// A) Agrega a la ficha clínica del RUBRO de la demo (RubroTemplate.camposFicha,
//    hoy "Salud Privada") un grupo "Evolución de la sesión" con 3 campos de
//    varias líneas (porSesion: la nota nueva no los arrastra de la anterior):
//    Evolución, Exámenes solicitados e Indicaciones. Además deja
//    como texto de varias líneas Motivo de consulta, Antecedentes relevantes y
//    Plan de tratamiento. OJO: es la ficha del RUBRO, así que la ven todas las
//    empresas de ese rubro; el DRY-RUN las lista antes de cambiar nada.
//
// B) Carga NOTAS CLÍNICAS DE EJEMPLO (AtencionClinica) en la empresa de demo del
//    56984084321: una nota de ingreso en la primera sesión de cada paciente y
//    notas de evolución cada ~4 sesiones, con exámenes e indicaciones. Solo en
//    pacientes de ejemplo (teléfonos 569000001xx). Sin fechaProximaCitaFijada ni
//    modo de recordatorio (nunca dispara recordatoriosFicha; además la demo no
//    tiene WhatsApp propio). Reemplaza las notas previas de esos pacientes.
//
// USO (Shell de Render, producción):
//   node scripts/_ficha-evolucion-y-notas-demo-clinica-17nov.js              # DRY-RUN
//   CONFIRMAR=1 node scripts/_ficha-evolucion-y-notas-demo-clinica-17nov.js  # aplica

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const TELEFONO_DEMO = '56984084321';
const APLICAR = process.env.CONFIRMAR === '1';

const GRUPO_EVOLUCION = {
  titulo: 'Evolución de la sesión',
  campos: [
    { path: ['evolucion'], label: 'Evolución', tipo: 'textarea', porSesion: true, placeholder: 'Cómo llega hoy, respuesta al tratamiento, dolor (0-10)…' },
    { path: ['examenesSolicitados'], label: 'Exámenes solicitados', tipo: 'textarea', porSesion: true, placeholder: 'Ej.: resonancia lumbar, radiografía de columna completa…' },
    { path: ['indicaciones'], label: 'Indicaciones', tipo: 'textarea', porSesion: true, placeholder: 'Ejercicios, cuidados, próximos pasos…' },
  ],
};
const PASAR_A_TEXTAREA = ['Motivo de consulta', 'Antecedentes relevantes', 'Plan de tratamiento'];

// Contenido de EJEMPLO por tratamiento principal.
const CASOS = {
  Quiropraxia: {
    motivo: 'Dolor lumbar de 3 semanas, peor al estar sentado en el trabajo.', zona: 'Columna lumbar (L4-L5)',
    diagnostico: 'Lumbalgia mecánica con restricción segmentaria L4-L5', plan: 'Ajustes quiroprácticos semanales + ejercicios de core', sesiones: '12',
    antecedentes: 'Trabajo de oficina, sedentario. Sin cirugías de columna.', medicamentos: 'Ibuprofeno 400 mg SOS',
    examenes: 'Radiografía de columna lumbar AP y lateral.',
  },
  'Camilla hernia discal': {
    motivo: 'Dolor lumbar irradiado a pierna izquierda, hormigueo en el pie.', zona: 'Columna lumbar, irradiado a pierna izquierda',
    diagnostico: 'Hernia discal L5-S1 con radiculopatía izquierda', plan: 'Flexión distracción 2 veces por semana el primer mes, luego semanal', sesiones: '16',
    antecedentes: 'Episodio similar hace 2 años. Trabajo con carga de peso.', medicamentos: 'Pregabalina 75 mg (indicada por traumatólogo)',
    examenes: 'Resonancia magnética de columna lumbar.',
  },
  'Tratamiento escoliosis': {
    motivo: 'Control de escoliosis detectada en el colegio; dolor dorsal al final del día.', zona: 'Columna dorsolumbar',
    diagnostico: 'Escoliosis idiopática dorsolumbar, Cobb 22°', plan: 'Tratamiento tenso activo semanal + ejercicios de reeducación postural en casa', sesiones: '20',
    antecedentes: 'Madre con escoliosis. Practica natación.', medicamentos: 'Ninguno',
    examenes: 'Radiografía de columna total de pie (telerradiografía) para medir ángulo de Cobb.',
  },
  Kinesiología: {
    motivo: 'Dolor cervical y rigidez al girar la cabeza, cefalea por las tardes.', zona: 'Columna cervical y trapecios',
    diagnostico: 'Cervicalgia mecánica con contractura de trapecio superior', plan: 'Terapia manual, ejercicios de movilidad cervical y fortalecimiento escapular', sesiones: '10',
    antecedentes: 'Uso prolongado de computador. Estrés laboral.', medicamentos: 'Paracetamol 1 g SOS',
    examenes: 'No requiere por ahora.',
  },
  'Punción seca': {
    motivo: 'Dolor en glúteo y cara posterior del muslo al correr.', zona: 'Glúteo medio y piriforme derecho',
    diagnostico: 'Síndrome miofascial de glúteo medio y piriforme', plan: 'Punción seca + electroneuromodulación y elongación', sesiones: '8',
    antecedentes: 'Corredor amateur, 30 km semanales.', medicamentos: 'Ninguno',
    examenes: 'Ecografía de cadera si no mejora a la 4.ª sesión.',
  },
  'Electrólisis percutánea': {
    motivo: 'Dolor en el talón al dar los primeros pasos de la mañana.', zona: 'Fascia plantar izquierda',
    diagnostico: 'Fascitis plantar crónica', plan: 'EPI eco guiada cada 10 días + ejercicios excéntricos', sesiones: '6',
    antecedentes: 'Trabaja de pie todo el día.', medicamentos: 'Ninguno',
    examenes: 'Ecografía de fascia plantar.',
  },
  'Terapia KineticXer': {
    motivo: 'Dolor y tensión en hombro derecho al levantar el brazo.', zona: 'Hombro derecho',
    diagnostico: 'Tendinopatía del supraespinoso con restricción miofascial', plan: 'Terapia instrumental + ejercicios de manguito rotador', sesiones: '8',
    antecedentes: 'Juega pádel 3 veces por semana.', medicamentos: 'Ninguno',
    examenes: 'Ecografía de hombro derecho.',
  },
  'Estudio de pisada': {
    motivo: 'Dolor de rodillas al caminar largas distancias.', zona: 'Pies y rodillas',
    diagnostico: 'Pie plano flexible bilateral con sobrecarga de rodillas', plan: 'Plantillas ortopédicas + ejercicios de arco plantar', sesiones: '3',
    antecedentes: 'Sobrepeso leve.', medicamentos: 'Ninguno',
    examenes: 'Baropodometría (estudio de pisada).',
  },
};
const EVOLUCIONES = [
  ['Llega con dolor 7/10. Movilidad limitada al inicio de la sesión; mejora al final.', 'Hielo 15 min 2 veces al día. Evitar estar sentado más de 1 hora seguida.'],
  ['Refiere dolor 5/10, duerme mejor. Mejor rango de movimiento.', 'Agregar ejercicios de core 3 veces por semana (pauta entregada).'],
  ['Dolor 3/10. Ya no despierta con dolor. Tolera bien la carga.', 'Progresar ejercicios. Retomar actividad física suave.'],
  ['Dolor 2/10, solo al final del día. Buena adherencia a los ejercicios.', 'Mantener ejercicios en casa. Espaciar sesiones a cada 15 días.'],
  ['Sin dolor en reposo, molestia leve con esfuerzo. Objetivos casi cumplidos.', 'Pauta de mantención en casa. Control en 1 mes.'],
];

function rutaPorEtiqueta(camposFicha) {
  const m = {};
  for (const g of camposFicha?.grupos || []) for (const c of g.campos || []) m[c.label] = c.path;
  return m;
}
function setRuta(obj, path, valor) {
  if (!path) return;
  let n = obj;
  for (let i = 0; i < path.length - 1; i++) n = n[path[i]] = n[path[i]] || {};
  n[path[path.length - 1]] = valor;
}
const soloDia = (d) => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d)}T00:00:00.000Z`);

async function main() {
  const demo = await prisma.demoAsignada.findUnique({
    where: { telefono: TELEFONO_DEMO },
    select: { id: true, empresaDemo: { select: { id: true, nombre: true, esDemo: true, whatsappNumeroId: true, rubroTemplateId: true } } },
  });
  if (!demo) throw new Error(`No hay demo para ${TELEFONO_DEMO}.`);
  const empresa = demo.empresaDemo;
  if (!empresa.esDemo || empresa.whatsappNumeroId) throw new Error('La empresa no es una demo sin WhatsApp propio: no se toca.');

  // ---- A) Ficha del rubro ----
  const rubro = await prisma.rubroTemplate.findUnique({ where: { id: empresa.rubroTemplateId }, select: { id: true, nombre: true, camposFicha: true } });
  const empresasDelRubro = await prisma.empresa.findMany({ where: { rubroTemplateId: rubro.id, esDemo: false }, select: { nombre: true } });
  console.log(`${APLICAR ? 'APLICANDO' : 'DRY-RUN (nada se escribe)'}`);
  console.log(`Rubro "${rubro.nombre}". Empresas REALES que usan esta ficha: ${empresasDelRubro.length ? empresasDelRubro.map((e) => e.nombre).join(', ') : 'ninguna'}.`);

  const ficha = JSON.parse(JSON.stringify(rubro.camposFicha || { grupos: [] }));
  ficha.grupos = ficha.grupos || [];
  const cambiosFicha = [];
  for (const g of ficha.grupos) for (const c of g.campos || []) {
    if (PASAR_A_TEXTAREA.includes(c.label) && c.tipo !== 'textarea') { c.tipo = 'textarea'; cambiosFicha.push(`"${c.label}" pasa a varias líneas`); }
  }
  if (!ficha.grupos.some((g) => g.titulo === GRUPO_EVOLUCION.titulo)) {
    ficha.grupos.push(GRUPO_EVOLUCION);
    cambiosFicha.push(`grupo nuevo "${GRUPO_EVOLUCION.titulo}": ${GRUPO_EVOLUCION.campos.map((c) => c.label).join(', ')}`);
  }
  console.log(cambiosFicha.length ? `Ficha: ${cambiosFicha.join('; ')}.` : 'Ficha: ya estaba actualizada.');
  console.log('Campos de la ficha después del cambio:', ficha.grupos.map((g) => `[${g.titulo || ''}] ${g.campos.map((c) => c.label).join(', ')}`).join(' | '));
  const ruta = rutaPorEtiqueta(ficha);

  // ---- B) Notas de ejemplo ----
  const pacientes = await prisma.cliente.findMany({
    where: { empresaId: empresa.id, telefono: { startsWith: '569000001' } },
    select: {
      id: true, nombre: true,
      citas: { where: { estado: 'COMPLETADA' }, orderBy: { fechaHoraInicio: 'asc' }, select: { fechaHoraInicio: true, servicio: { select: { nombre: true } }, recurso: { select: { nombre: true } } } },
    },
  });
  const notas = [];
  for (const p of pacientes) {
    if (!p.citas.length) continue;
    // tratamiento principal = servicio más frecuente
    const cuenta = {};
    for (const c of p.citas) cuenta[c.servicio?.nombre] = (cuenta[c.servicio?.nombre] || 0) + 1;
    const principal = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0];
    const caso = CASOS[principal] || CASOS.Kinesiología;
    const profesional = p.citas[0].recurso?.nombre || null;
    const fichaIngreso = {};
    setRuta(fichaIngreso, ruta['Motivo de consulta'], caso.motivo);
    setRuta(fichaIngreso, ruta['Antecedentes relevantes'], caso.antecedentes);
    setRuta(fichaIngreso, ruta['Medicamentos actuales'], caso.medicamentos);
    setRuta(fichaIngreso, ruta['Zona afectada'], caso.zona);
    setRuta(fichaIngreso, ruta['Profesional responsable'], profesional);
    setRuta(fichaIngreso, ruta['Plan de tratamiento'], caso.plan);
    setRuta(fichaIngreso, ruta['Sesiones recomendadas'], caso.sesiones);
    setRuta(fichaIngreso, ruta['Evolución'], 'Primera sesión: evaluación inicial y examen físico. ' + EVOLUCIONES[0][0]);
    setRuta(fichaIngreso, ruta['Exámenes solicitados'], caso.examenes);
    setRuta(fichaIngreso, ruta['Indicaciones'], EVOLUCIONES[0][1]);
    notas.push({ clienteId: p.id, fecha: soloDia(p.citas[0].fechaHoraInicio), fichaJson: fichaIngreso, diagnostico: caso.diagnostico, profesionalAtendio: profesional });

    // evolución cada 4 sesiones
    let k = 1;
    for (let i = 4; i < p.citas.length; i += 4, k++) {
      const [evo, ind] = EVOLUCIONES[Math.min(k, EVOLUCIONES.length - 1)];
      const f = {};
      setRuta(f, ruta['Zona afectada'], caso.zona);
      setRuta(f, ruta['Profesional responsable'], profesional);
      setRuta(f, ruta['Plan de tratamiento'], caso.plan);
      setRuta(f, ruta['Evolución'], `Sesión ${i + 1}. ${evo}`);
      setRuta(f, ruta['Indicaciones'], ind);
      if (k === 2) setRuta(f, ruta['Exámenes solicitados'], `Se revisa resultado: ${caso.examenes.replace(/\.$/, '')}, sin hallazgos que contraindiquen el tratamiento.`);
      notas.push({ clienteId: p.id, fecha: soloDia(p.citas[i].fechaHoraInicio), fichaJson: f, diagnostico: caso.diagnostico, profesionalAtendio: profesional });
    }
  }
  const previas = await prisma.atencionClinica.count({ where: { clienteId: { in: pacientes.map((p) => p.id) } } });
  console.log(`Notas de ejemplo: ${notas.length} para ${new Set(notas.map((n) => n.clienteId)).size} pacientes (se reemplazan ${previas} previas de esos pacientes).`);
  const ejemplo = notas[0];
  if (ejemplo) console.log('Ejemplo de nota de ingreso:', JSON.stringify({ diagnostico: ejemplo.diagnostico, ...ejemplo.fichaJson }));

  if (!APLICAR) {
    console.log('\nNada se escribió. Para aplicar: CONFIRMAR=1 node scripts/_ficha-evolucion-y-notas-demo-clinica-17nov.js');
    return;
  }

  if (cambiosFicha.length) await prisma.rubroTemplate.update({ where: { id: rubro.id }, data: { camposFicha: ficha }, select: { id: true } });
  await prisma.atencionClinica.deleteMany({ where: { clienteId: { in: pacientes.map((p) => p.id) } } });
  for (let i = 0; i < notas.length; i += 500) await prisma.atencionClinica.createMany({ data: notas.slice(i, i + 500) });
  // Resumen del paciente (mismo criterio que recalcularCacheCliente, sin tocar su próxima cita)
  const ultimaPorCliente = {};
  for (const n of notas) if (!ultimaPorCliente[n.clienteId] || n.fecha > ultimaPorCliente[n.clienteId].fecha) ultimaPorCliente[n.clienteId] = n;
  for (const n of Object.values(ultimaPorCliente)) {
    await prisma.cliente.update({ where: { id: n.clienteId }, data: { fichaJson: n.fichaJson, diagnostico: n.diagnostico, profesionalAtendio: n.profesionalAtendio }, select: { id: true } });
  }
  console.log(`✅ Ficha del rubro ${cambiosFicha.length ? 'actualizada' : 'sin cambios'}. ✅ ${notas.length} notas creadas. ✅ Listo.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
