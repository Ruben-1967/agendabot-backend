#!/usr/bin/env node
// Uso puntual (2026-10-16): crea en la plataforma la Empresa "Multidigital" que
// recibirá, en el WhatsApp +56 9 6610 8858, los mensajes de los interesados que
// lleguen desde los anuncios de Meta (Click-to-WhatsApp). La persona del equipo
// los lee y responde desde "Chats en vivo" del panel; el bot solo informa.
//
// Crea: Empresa (real, no demo) + Usuario ADMIN (entra por código al correo,
// con una contraseña aleatoria que nadie conoce) + Suscripción exenta (es de la
// casa, no paga). NO conecta el WhatsApp (eso lo hace conectar-whatsapp-manual.js
// después) y NO manda ningún mensaje.
//
// Resguardos (por el historial de empresas duplicadas de LuxVision/Barber):
//   - Si ya existe una Empresa real llamada exactamente "Multidigital", aborta.
//   - Si el correo ya pertenece a un Usuario, aborta (NO lo mueve de empresa:
//     crear-usuario.js sí lo haría).
//
// USO (Shell de Render, producción):
//   EMAIL_ADMIN=<correo del administrador> node scripts/_crear-empresa-multidigital-16oct.js
//   (opcional NOMBRE_ADMIN="Rubén González")

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { PLANES } = require('../src/services/contratoHtml');

const NOMBRE_EMPRESA = 'Multidigital';
const EMAIL_ADMIN = (process.env.EMAIL_ADMIN || '').toLowerCase().trim();
const NOMBRE_ADMIN = process.env.NOMBRE_ADMIN || 'Rubén González';

const INFORMACION_ADICIONAL = `Esta es la ÚNICA información que puedes citar sobre Multidigital. Si te preguntan algo que no está aquí (permanencia, condiciones del contrato, plazos de entrega, precios de otros servicios), NO lo inventes: dile que una persona del equipo se lo confirma y ofrece que continúe la conversación.
Quiénes somos: Multidigital, empresa chilena de servicios digitales para pymes. Sitio web: https://multidigital.cl
Oferta de entrada: página web (landing) a la medida con 2 correos corporativos @tuempresa.cl. Valor: $9.900 al mes + IVA. El hosting cuesta 1 UF al año (+ IVA); el primer año tiene 50% de descuento. La UF cambia cada día: hoy es aproximadamente $41.100, solo como referencia.
Otros servicios: TotemSystem (asistente de agendamiento por WhatsApp con inteligencia artificial, desde $14.900 al mes + IVA), materiales gráficos y comercio electrónico. Para detalles o cotizaciones de cualquiera de ellos, una persona del equipo continúa la conversación.
Este chat NO agenda citas ni reuniones: si el cliente quiere contratar, cotizar o conversar con alguien, ofrécele que una persona del equipo le responderá por este mismo chat (usa escalar_a_humano si lo pide).
Sé breve, cordial y no presiones. Si el cliente dice que no le interesa, agradécele y no insistas.`;

async function main() {
  if (!EMAIL_ADMIN || !EMAIL_ADMIN.includes('@')) throw new Error('Falta EMAIL_ADMIN=<correo> (no puede ser el de otra empresa).');

  const yaExiste = await prisma.empresa.findFirst({ where: { nombre: { equals: NOMBRE_EMPRESA, mode: 'insensitive' }, esDemo: false }, select: { id: true } });
  if (yaExiste) throw new Error(`Ya existe una Empresa real "${NOMBRE_EMPRESA}" (${yaExiste.id}) -- no se crea otra. Úsala o bórrala primero.`);

  const usuarioExistente = await prisma.usuario.findUnique({ where: { email: EMAIL_ADMIN }, select: { empresa: { select: { nombre: true } } } });
  if (usuarioExistente) throw new Error(`El correo ya pertenece a un usuario de la empresa "${usuarioExistente.empresa?.nombre}". Usa otro correo: no se mueve a nadie de empresa.`);

  const rubro = await prisma.rubroTemplate.findFirst({ where: { nombre: { contains: 'marketing', mode: 'insensitive' } } });
  if (!rubro) {
    const todos = await prisma.rubroTemplate.findMany({ select: { nombre: true }, orderBy: { nombre: 'asc' } });
    throw new Error(`No hay un rubro con "marketing". Rubros disponibles: ${todos.map((r) => r.nombre).join(' | ')}`);
  }

  const plan = PLANES.PLAN_A;
  const ahora = new Date();
  const en30dias = new Date(ahora.getTime() + 30 * 24 * 3600 * 1000);

  const resultado = await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.create({
      data: {
        nombre: NOMBRE_EMPRESA,
        rubroTemplateId: rubro.id,
        esDemo: false,
        sitioWeb: 'https://multidigital.cl',
        tonoComunicacion: 'Neutral',
        informacionAdicional: INFORMACION_ADICIONAL,
      },
    });
    const usuario = await tx.usuario.create({
      data: {
        empresaId: empresa.id,
        nombre: NOMBRE_ADMIN,
        email: EMAIL_ADMIN,
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
        rol: 'ADMIN',
      },
    });
    await tx.suscripcion.create({
      data: {
        empresaId: empresa.id,
        plan: 'PLAN_A',
        estado: 'ACTIVA',
        fechaActivacion: ahora,
        montoMensualActual: 0,
        citasIncluidas: plan.citasIncluidas,
        precioCitaExcedente: plan.precioCitaExcedente,
        exentoDePlan: true,
        exentoDeHosting: true,
        fechaProximoCobro: en30dias,
        fechaProximoCobroHosting: en30dias,
      },
    });
    return { empresa, usuario };
  });

  console.log(`✅ Empresa creada: "${resultado.empresa.nombre}"`);
  console.log(`   EMPRESA_ID = ${resultado.empresa.id}`);
  console.log(`   Rubro: ${rubro.nombre} | Administrador: ${resultado.usuario.nombre} <${resultado.usuario.email}> (entra con el código que llega a ese correo)`);
  console.log('   Suscripción: ACTIVA, exenta de plan y de hosting.');
  console.log('\nSiguiente paso: conectar el WhatsApp con scripts/conectar-whatsapp-manual.js usando ese EMPRESA_ID.');
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
