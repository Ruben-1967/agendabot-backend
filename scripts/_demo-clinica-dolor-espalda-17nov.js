#!/usr/bin/env node
// Uso puntual (17-nov-2026): completa la demo de la Clínica del Dolor de
// Espalda (dolordeespalda.cl, dueño David López, quiropráctico) para la
// reunión del 18-nov 14:30. La demo la creó Rubén en el panel de vendedores
// para el teléfono 56984084321 (desde ahí escribe al número de demos
// +56 9 2767 9838).
//
// Qué hace, SOLO sobre la Empresa de esa demo (esDemo=true, sin WhatsApp propio):
//   1. Datos reales del sitio (dirección, horario, servicios) en informacionAdicional.
//   2. Dos agendas (RecursoAgendable): David López y el equipo de Kinesiología,
//      con el horario real L-V 09:00-13:30 y 15:00-20:30.
//   3. 8 servicios, cada uno ligado a su agenda (máx. 9 por el límite de 10
//      filas de la lista de WhatsApp, la 10.ª es "Otro").
//   4. Pacientes y citas de EJEMPLO del 18 al 23-nov para que el panel tenga
//      movimiento. Teléfonos fijos y obviamente falsos (56900000101-112): nunca
//      reciben nada, y además ningún job envía mensajes a empresas sin
//      whatsappNumeroId (confirmarCitasProximas, enviarRecordatorios, recordatoriosFicha).
//   5. (Opcional) usuario ADMIN demo.dolorespalda@multidigital.cl para mostrar el
//      panel, con la contraseña que se pase en la variable DEMO_PASSWORD (leerla
//      con `read -s`, nunca escribirla en el comando ni en el chat).
//
// Idempotente: no duplica agendas, servicios, pacientes ni citas.
//
// USO (Shell de Render, producción):
//   node scripts/_demo-clinica-dolor-espalda-17nov.js              # DRY-RUN: solo muestra
//   read -s DEMO_PASSWORD && export DEMO_PASSWORD
//   CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-17nov.js  # aplica
//   unset DEMO_PASSWORD                                            # borrarla de la sesión

require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { horaChileAFechaUTC } = require('../src/lib/horaChile');

const TELEFONO_DEMO = process.env.TELEFONO_DEMO_PRUEBA || '56984084321'; // override solo para probar en staging
const APLICAR = process.env.CONFIRMAR === '1';
const EMAIL_ADMIN = 'demo.dolorespalda@multidigital.cl';

const NOMBRE = 'Clínica del Dolor de Espalda';
const DIRECCION = 'Santa María 217, oficinas 12 y 13, Recoleta, Santiago';

const INFORMACION_ADICIONAL = `Clínica del Dolor de Espalda: clínica de salud quiropráctica y kinesiológica, especializada en la columna vertebral y en afecciones neuromusculoesqueléticas. Director: David López Sánchez, quiropráctico (DC).
Dirección: Santa María 217, oficinas 12 y 13, Recoleta, Santiago.
Horario: lunes a viernes de 9:00 a 13:30 y de 15:00 a 20:30.
Teléfonos: WhatsApp +56 9 5452 6961; fijos +56 2 2735 4577, +56 2 2737 4291 y +56 2 2737 4136.
Hay dos agendas: (1) David López, quiropráctico: quiropraxia, tratamiento de la escoliosis (método tenso activo, FED + CLEAR) y camilla de flexión distracción para hernia discal; (2) equipo de kinesiología: kinesiología y rehabilitación, punción seca y electroneuromodulación, electrólisis percutánea (EPI) eco guiada, terapia instrumental KineticXer, y estudio de pisada (baropodometría, podoscopía y plantillas ortopédicas).
También hacen myoscanner y termografía de columna y terapia neural: para esos se coordina por WhatsApp.
Convenio con Gendarmería de Chile para funcionarios y sus familias.
No inventes precios, valores de sesión, coberturas de Fonasa o isapre ni duraciones de tratamiento: si preguntan, di que lo confirma la ejecutiva de atención por WhatsApp.`;

const HORARIO = [
  ['09:00', '13:30'],
  ['15:00', '20:30'],
];

const AGENDAS = [
  {
    clave: 'david',
    nombre: 'David López · Quiropráctico',
    duracion: 30,
    servicios: ['Quiropraxia', 'Tratamiento escoliosis', 'Camilla hernia discal'],
  },
  {
    clave: 'kine',
    nombre: 'Kinesiología (equipo)',
    duracion: 45,
    servicios: ['Kinesiología', 'Punción seca', 'Electrólisis percutánea', 'Terapia KineticXer', 'Estudio de pisada'],
  },
];

// Pacientes de EJEMPLO: nombres comunes, teléfonos fijos y obviamente falsos.
const PACIENTES = [
  ['Camila Rojas', '56900000101'],
  ['Javier Muñoz', '56900000102'],
  ['Valentina Soto', '56900000103'],
  ['Matías González', '56900000104'],
  ['Francisca Díaz', '56900000105'],
  ['Felipe Contreras', '56900000106'],
  ['Antonia Silva', '56900000107'],
  ['Sebastián Morales', '56900000108'],
  ['Catalina Fuentes', '56900000109'],
  ['Diego Araya', '56900000110'],
  ['Josefa Castillo', '56900000111'],
  ['Tomás Reyes', '56900000112'],
];

// Citas de EJEMPLO: [fecha, hora, agenda, servicio, índice paciente, estado]
const CITAS = [
  ['2026-11-18', '09:00', 'david', 'Quiropraxia', 0, 'CONFIRMADA'],
  ['2026-11-18', '09:30', 'david', 'Quiropraxia', 1, 'CONFIRMADA'],
  ['2026-11-18', '10:30', 'david', 'Camilla hernia discal', 2, 'CONFIRMADA'],
  ['2026-11-18', '11:30', 'david', 'Tratamiento escoliosis', 3, 'PENDIENTE'],
  ['2026-11-18', '15:30', 'david', 'Quiropraxia', 4, 'PENDIENTE'],
  ['2026-11-18', '17:00', 'david', 'Quiropraxia', 5, 'CONFIRMADA'],
  ['2026-11-18', '09:00', 'kine', 'Kinesiología', 6, 'CONFIRMADA'],
  ['2026-11-18', '10:30', 'kine', 'Punción seca', 7, 'CONFIRMADA'],
  ['2026-11-18', '12:00', 'kine', 'Estudio de pisada', 8, 'PENDIENTE'],
  ['2026-11-18', '15:00', 'kine', 'Electrólisis percutánea', 9, 'CONFIRMADA'],
  ['2026-11-18', '16:30', 'kine', 'Kinesiología', 10, 'PENDIENTE'],
  ['2026-11-19', '10:00', 'david', 'Quiropraxia', 11, 'PENDIENTE'],
  ['2026-11-19', '16:00', 'david', 'Tratamiento escoliosis', 0, 'PENDIENTE'],
  ['2026-11-19', '09:00', 'kine', 'Kinesiología', 6, 'PENDIENTE'],
  ['2026-11-19', '11:15', 'kine', 'Terapia KineticXer', 2, 'PENDIENTE'],
  ['2026-11-20', '09:30', 'david', 'Camilla hernia discal', 2, 'PENDIENTE'],
  ['2026-11-20', '15:00', 'kine', 'Punción seca', 7, 'PENDIENTE'],
  ['2026-11-23', '18:00', 'david', 'Quiropraxia', 4, 'PENDIENTE'],
];

const log = (...a) => console.log(APLICAR ? '' : '[DRY-RUN]', ...a);

async function main() {
  const demo = await prisma.demoAsignada.findUnique({
    where: { telefono: TELEFONO_DEMO },
    select: {
      id: true,
      empresaDemo: {
        select: { id: true, nombre: true, esDemo: true, whatsappNumeroId: true, rubroTemplate: { select: { nombre: true, modoOperacion: true } } },
      },
    },
  });
  if (!demo) throw new Error(`No hay demo para ${TELEFONO_DEMO}: créala primero en el panel de vendedores.`);
  const empresa = demo.empresaDemo;
  if (!empresa.esDemo) throw new Error('La empresa vinculada NO es de demo (esDemo=false): no se toca.');
  if (empresa.whatsappNumeroId) throw new Error('La empresa de demo tiene WhatsApp propio conectado: no se toca (podría enviar mensajes reales).');
  if (empresa.rubroTemplate.modoOperacion !== 'AGENDAMIENTO') throw new Error(`El rubro "${empresa.rubroTemplate.nombre}" no es de agendamiento.`);
  const otrasDemos = await prisma.demoAsignada.count({ where: { empresaDemoId: empresa.id, NOT: { id: demo.id } } });
  if (otrasDemos > 0) throw new Error(`La empresa de demo la comparten ${otrasDemos} demo(s) más: no se toca.`);
  // Chequeo del email ANTES de escribir nada (si no, la demo quedaría a medio aplicar).
  const usuario = await prisma.usuario.findFirst({ where: { email: EMAIL_ADMIN }, select: { id: true, empresaId: true } });
  if (usuario && usuario.empresaId !== empresa.id) throw new Error(`${EMAIL_ADMIN} ya existe en OTRA empresa: no se toca.`);
  console.log(`Demo de ${TELEFONO_DEMO} → Empresa "${empresa.nombre}" (${empresa.id}), rubro ${empresa.rubroTemplate.nombre}. ${APLICAR ? 'APLICANDO' : 'DRY-RUN (nada se escribe)'}`);

  // 1. Datos de la empresa. OJO: NO se escribe telefonoContacto. POST
  // /auth/solicitar-reset-password (público) manda un WhatsApp real a
  // Empresa.telefonoContacto desde DEMO_PHONE_NUMBER_ID sin filtrar esDemo: con
  // el número de la clínica, un "olvidé mi contraseña" le llegaría al prospecto
  // (auditoría whatsapp-safety-checker, 17-nov). El número va solo en el texto.
  log(`Empresa: nombre "${NOMBRE}", dirección y información adicional (${INFORMACION_ADICIONAL.length} caracteres).`);
  if (APLICAR) {
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: { nombre: NOMBRE, direccion: DIRECCION, informacionAdicional: INFORMACION_ADICIONAL },
      select: { id: true },
    });
  }

  // 2 y 3. Agendas, horarios y servicios
  const recursoPorClave = {};
  const servicioPorNombre = {};
  for (const ag of AGENDAS) {
    let recurso = await prisma.recursoAgendable.findFirst({ where: { empresaId: empresa.id, nombre: ag.nombre } });
    if (recurso) {
      log(`Agenda "${ag.nombre}" ya existía.`);
    } else {
      log(`Agenda nueva: "${ag.nombre}" (${ag.duracion} min), L-V ${HORARIO.map((h) => h.join('-')).join(' y ')}.`);
      if (APLICAR) {
        recurso = await prisma.recursoAgendable.create({
          data: {
            empresaId: empresa.id,
            nombre: ag.nombre,
            tipo: 'profesional',
            duracionCitaMinutos: ag.duracion,
            horarios: {
              create: [1, 2, 3, 4, 5].flatMap((dia) => HORARIO.map(([horaInicio, horaFin]) => ({ diaSemana: dia, horaInicio, horaFin }))),
            },
          },
        });
      }
    }
    recursoPorClave[ag.clave] = recurso;

    for (const nombreServ of ag.servicios) {
      let servicio = await prisma.servicio.findFirst({ where: { empresaId: empresa.id, nombre: nombreServ } });
      if (!servicio) {
        log(`  Servicio nuevo: "${nombreServ}" → ${ag.nombre}`);
        if (APLICAR) {
          servicio = await prisma.servicio.create({ data: { empresaId: empresa.id, nombre: nombreServ, duracionMinutos: ag.duracion, activo: true } });
        }
      } else {
        log(`  Servicio "${nombreServ}" ya existía.`);
      }
      if (APLICAR && servicio && recurso) {
        await prisma.servicioRecurso.upsert({
          where: { servicioId_recursoAgendableId: { servicioId: servicio.id, recursoAgendableId: recurso.id } },
          update: {},
          create: { servicioId: servicio.id, recursoAgendableId: recurso.id },
        });
      }
      servicioPorNombre[nombreServ] = servicio;
    }
  }

  // Servicios del rubro genérico que el panel de vendedores pudo dejar ("Sesión de evaluación", "Control"): se desactivan.
  const nombresValidos = AGENDAS.flatMap((a) => a.servicios);
  const sobrantes = await prisma.servicio.findMany({ where: { empresaId: empresa.id, activo: true, nombre: { notIn: nombresValidos } } });
  for (const s of sobrantes) {
    log(`Servicio ajeno desactivado: "${s.nombre}"`);
    if (APLICAR) await prisma.servicio.update({ where: { id: s.id }, data: { activo: false } });
  }

  // 4. Pacientes y citas de ejemplo
  const clientes = [];
  for (const [nombre, telefono] of PACIENTES) {
    let cliente = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, telefono } });
    if (!cliente && APLICAR) {
      cliente = await prisma.cliente.create({ data: { empresaId: empresa.id, nombre, telefono } });
    }
    clientes.push(cliente);
  }
  log(`Pacientes de ejemplo: ${PACIENTES.length} (teléfonos 56900000101-112).`);

  let creadas = 0;
  for (const [fecha, hora, clave, nombreServ, idx, estado] of CITAS) {
    const ag = AGENDAS.find((a) => a.clave === clave);
    const inicio = horaChileAFechaUTC(fecha, hora);
    const fin = new Date(inicio.getTime() + ag.duracion * 60000);
    const recurso = recursoPorClave[clave];
    if (recurso) {
      const existe = await prisma.cita.findFirst({ where: { recursoAgendableId: recurso.id, fechaHoraInicio: inicio } });
      if (existe) continue;
    }
    creadas++;
    log(`  Cita ${fecha} ${hora} · ${ag.nombre} · ${nombreServ} · ${PACIENTES[idx][0]} · ${estado}`);
    if (APLICAR) {
      await prisma.cita.create({
        data: {
          empresaId: empresa.id,
          clienteId: clientes[idx].id,
          recursoAgendableId: recurso.id,
          servicioId: servicioPorNombre[nombreServ].id,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          estado,
          origenCanal: 'whatsapp',
          nombrePaciente: PACIENTES[idx][0],
        },
      });
    }
  }
  log(`Citas nuevas: ${creadas}.`);

  // 5. Usuario ADMIN para mostrar el panel
  if (!process.env.DEMO_PASSWORD) {
    log(`Usuario ${EMAIL_ADMIN}: ${usuario ? 'ya existe' : 'NO se crea'} (falta DEMO_PASSWORD).`);
  } else if (process.env.DEMO_PASSWORD.length < 8) {
    throw new Error('DEMO_PASSWORD debe tener al menos 8 caracteres.');
  } else {
    log(`Usuario ADMIN ${EMAIL_ADMIN}: ${usuario ? 'se actualiza la contraseña' : 'se crea'}.`);
    if (APLICAR) {
      const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD, 10);
      if (usuario) {
        await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash } });
      } else {
        await prisma.usuario.create({
          data: { empresaId: empresa.id, nombre: 'David López (demo)', email: EMAIL_ADMIN, rol: 'ADMIN', passwordHash, fechaActivacionCuenta: new Date() },
        });
      }
    }
  }

  // La demo de WhatsApp parte desde cero la próxima vez que escriba el 56984084321.
  log('Estado de la demo de WhatsApp reiniciado (paso 0).');
  if (APLICAR) await prisma.demoAsignada.update({ where: { id: demo.id }, data: { paso: 0, historialSimulacion: [], citaDemoJson: null } });

  console.log(APLICAR ? '✅ Listo.' : '\nNada se escribió. Para aplicar: CONFIRMAR=1 node scripts/_demo-clinica-dolor-espalda-17nov.js');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
