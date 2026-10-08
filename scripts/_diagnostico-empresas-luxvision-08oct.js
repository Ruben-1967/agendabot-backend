#!/usr/bin/env node
// Uso puntual (2026-10-08): hay 4 Empresas llamadas "Luxvision" (ver
// _diagnostico-chat-luxvision-08oct.js). Antes de configurar el chat de la
// tienda hay que saber CUÁL es la real: la que usa el dueño en el panel. Este
// script, SOLO LECTURA, lista por cada una: quién entra (emails enmascarados),
// cuántos datos reales tiene (clientes, citas, servicios, conversaciones,
// profesionales, chats) y cómo está configurada. No modifica nada.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-empresas-luxvision-08oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const enmascarar = (email) => {
  const [usuario, dominio] = String(email).split('@');
  return `${usuario.slice(0, 2)}***@${dominio || '?'}`;
};
const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

async function main() {
  const empresas = await prisma.empresa.findMany({
    where: { nombre: { contains: 'luxvision', mode: 'insensitive' } },
    include: { rubroTemplate: { select: { nombre: true, modoOperacion: true } }, suscripcion: { select: { estado: true, plan: true, exentoDePlan: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Empresas "Luxvision": ${empresas.length}\n`);

  for (const e of empresas) {
    const [usuarios, clientes, citas, citasFuturas, servicios, recursos, conversaciones, ultimaConv] = await Promise.all([
      prisma.usuario.findMany({ where: { empresaId: e.id }, select: { email: true, rol: true } }),
      prisma.cliente.count({ where: { empresaId: e.id } }),
      prisma.cita.count({ where: { empresaId: e.id } }),
      prisma.cita.count({ where: { empresaId: e.id, fechaHoraInicio: { gte: new Date() } } }),
      prisma.servicio.count({ where: { empresaId: e.id } }),
      prisma.recursoAgendable.count({ where: { empresaId: e.id } }),
      prisma.conversacion.count({ where: { empresaId: e.id } }),
      prisma.conversacion.findFirst({ where: { empresaId: e.id }, orderBy: { actualizadoEn: 'desc' }, select: { actualizadoEn: true, canal: true } }),
    ]);
    console.log(`=== ${e.nombre}${e.sucursal ? ' · ' + e.sucursal : ''} | id ${e.id}`);
    console.log(`  creada ${fecha(e.createdAt)} | esDemo=${e.esDemo} | rubro="${e.rubroTemplate?.nombre}" (${e.rubroTemplate?.modoOperacion})`);
    console.log(`  WhatsApp: ${e.whatsappPhoneNumber || '(sin número)'} | Instagram: ${e.instagramCuentaId ? 'conectado' : 'no'}`);
    console.log(`  Suscripción: ${e.suscripcion ? `${e.suscripcion.estado} ${e.suscripcion.plan} exento=${e.suscripcion.exentoDePlan}` : '(ninguna)'}`);
    console.log(`  Usuarios del panel (${usuarios.length}): ${usuarios.map((u) => `${enmascarar(u.email)} [${u.rol}]`).join(', ') || '(ninguno)'}`);
    console.log(`  Clientes ${clientes} | Citas ${citas} (futuras ${citasFuturas}) | Servicios ${servicios} | Profesionales/recursos ${recursos} | Conversaciones ${conversaciones} (última ${fecha(ultimaConv?.actualizadoEn)} ${ultimaConv?.canal || ''})`);
    console.log(`  Config del bot: direccion=${e.direccion ? 'sí' : 'no'} | sitioWeb=${e.sitioWeb || 'no'} | informacionAdicional=${e.informacionAdicional ? e.informacionAdicional.length + ' caracteres' : 'vacía'} | catalogoVisualActivo=${e.catalogoVisualActivo} | tono=${e.tonoComunicacion}\n`);
  }
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
