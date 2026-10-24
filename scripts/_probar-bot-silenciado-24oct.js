#!/usr/bin/env node
// Prueba del bot silenciado por contacto (src/lib/botSilenciado.js) contra la base de
// STAGING, con el motor real (chatbotEngine.procesarMensajeEntrante), que NO envía nada
// por WhatsApp: solo devuelve el texto. Usa un teléfono de prueba fijo y ficticio, y al
// final borra todo lo que creó (conversación, cliente y ficha de Clientes Web).
// El caso 3 hace una llamada real a Anthropic (unos centavos).
//
// Se niega a correr fuera del servicio de staging de Render (RENDER_SERVICE_NAME).
//
// USO (Shell de Render staging):
//   node scripts/_probar-bot-silenciado-24oct.js

require('dotenv').config();

const TELEFONO_PRUEBA = '56900000099';

async function main() {
  const servicio = process.env.RENDER_SERVICE_NAME || '';
  if (!/staging/i.test(servicio)) {
    throw new Error(`Solo corre en staging (RENDER_SERVICE_NAME="${servicio}"). No se hizo nada.`);
  }

  const prisma = require('../src/lib/prisma');
  const { procesarMensajeEntrante } = require('../src/services/chatbotEngine');
  const { EMPRESA_ID_CLIENTES_WEB } = require('../src/lib/leadClienteWeb');

  let fallas = 0;
  const verificar = (descripcion, ok, detalle = '') => {
    console.log(`${ok ? '✅' : '❌'} ${descripcion}${ok ? '' : `  -> ${detalle}`}`);
    if (!ok) fallas++;
  };

  const empresa = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID_CLIENTES_WEB },
    include: { rubroTemplate: true },
  });
  if (!empresa) throw new Error(`No existe en staging la Empresa de Clientes Web (${EMPRESA_ID_CLIENTES_WEB}).`);
  console.log(`Empresa: ${empresa.nombre} | teléfono de prueba: ${TELEFONO_PRUEBA}\n`);

  const limpiar = async () => {
    await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } });
    await prisma.cliente.deleteMany({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } }).catch(() => {});
    await prisma.clienteWeb.deleteMany({ where: { telefono: TELEFONO_PRUEBA } });
  };
  const enviar = (texto) => procesarMensajeEntrante({ empresa, telefonoCliente: TELEFONO_PRUEBA, textoEntrante: texto, nombreContacto: 'Prueba silencio', canal: 'whatsapp' });
  const conversacion = () => prisma.conversacion.findFirst({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA, canal: 'whatsapp' } });

  try {
    await limpiar();

    console.log('1) Silencio manual (botSilenciadoEn)');
    await prisma.conversacion.create({
      data: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA, canal: 'whatsapp', mensajes: [], reservaEnCurso: null, botSilenciadoEn: new Date() },
    });
    let r = await enviar('Hola, sigo interesado');
    let conv = await conversacion();
    verificar('el bot no responde', r.respuestaTexto === null, r.respuestaTexto);
    verificar('el mensaje queda guardado', (conv.mensajes || []).some((m) => m.contenido === 'Hola, sigo interesado'));

    console.log('\n2) Silencio automático por Clientes Web (etapa EJEMPLO_ENVIADO), sin conversación previa');
    await prisma.conversacion.deleteMany({ where: { empresaId: empresa.id, telefono: TELEFONO_PRUEBA } });
    const ficha = await prisma.clienteWeb.create({
      data: { negocio: 'PRUEBA silencio bot (borrar)', telefono: TELEFONO_PRUEBA, etapa: 'EJEMPLO_ENVIADO' },
    });
    r = await enviar('¿Cómo va mi ejemplo?');
    conv = await conversacion();
    verificar('el bot no responde', r.respuestaTexto === null, r.respuestaTexto);
    verificar('se creó la conversación con el mensaje', !!conv && (conv.mensajes || []).length === 1);

    console.log('\n3) La ficha vuelve a INTERESADO: el bot responde de nuevo');
    await prisma.clienteWeb.update({ where: { id: ficha.id }, data: { etapa: 'INTERESADO' } });
    r = await enviar('Hola');
    verificar('el bot responde', typeof r.respuestaTexto === 'string' && r.respuestaTexto.length > 0, String(r.respuestaTexto));
    if (r.respuestaTexto) console.log(`  < ${r.respuestaTexto}`);
  } finally {
    // Si el caso 3 derivara, registrarLeadDesdeBot corre sin await: se le da tiempo
    // para que no quede una ficha huérfana después de la limpieza.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await limpiar();
    await prisma.$disconnect();
    console.log('\n(limpieza hecha: no queda nada del teléfono de prueba)');
  }

  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron.` : '\n✅ Todas las verificaciones pasaron.');
  process.exitCode = fallas ? 1 : 0;
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
