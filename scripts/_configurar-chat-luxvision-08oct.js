#!/usr/bin/env node
// Uso puntual (2026-10-08): deja configurada la Empresa "Luxvision" (la que tiene
// el WhatsApp +56 9 6343 1866 y el panel del dueño) para atender el botón de
// WhatsApp de la tienda luxvision.cl: datos reales de la tienda, dirección,
// sitio web, catálogo visual prendido y marcada como empresa REAL (estaba
// marcada demo: eso mezclaba 3 chats de ejemplo falsos entre los chats reales).
//
// Solo escribe en ESA Empresa (verifica el id y el número antes de tocar nada).
// Idempotente. NO manda ningún WhatsApp. Imprime qué cambió y qué servicios
// tiene cargados (el bot solo ofrece agendar los Servicios reales).
//
// USO (Shell de Render, producción):
//   node scripts/_configurar-chat-luxvision-08oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
const NUMERO_ESPERADO = '963431866';

const DIRECCION = 'Loreto 28 esquina Bellavista, a pasos del Metro Bellas Artes, Recoleta, Santiago';
const SITIO_WEB = 'https://luxvision.cl';

const INFORMACION_ADICIONAL = `Esta es la ÚNICA información que puedes citar sobre LuxVision.cl. Si te preguntan algo que no está aquí (modelos, precios o stock de un producto concreto, costos o plazos de despacho, condiciones de un cambio), NO lo inventes: dile que lo puede ver en la tienda online ${SITIO_WEB} o que lo confirma una persona del equipo.
Quiénes somos: LuxVision Chile, con más de 15 años de experiencia y la confianza de más de 25 mil clientes. Óptica con tienda física en Recoleta y tienda online: monturas, lentes ópticos, lentes para niños, gafas de sol y lentes de contacto, con atención oftalmológica. Trabajamos con marcas como Ray Ban, Ralph Lauren, Vogue, Armani Exchange, Miraflex y Superflex, y con lentes de contacto Johnson & Johnson y Bausch & Lomb. También hacemos atención empresarial, con exhibición de más de 400 productos, y vendemos equipos e instrumentos para ópticas.
Horario de la tienda: lunes a viernes de 10:00 a 13:30 y de 14:30 a 19:00; sábados de 10:00 a 19:00.
Atención oftalmológica (examen visual): lunes, miércoles, viernes y sábados. Las horas disponibles para agendar las muestra el sistema de agenda; se pueden agendar por este chat.
Si preguntan por atención o visitas a domicilio, no confirmes ni niegues: dile que una persona del equipo se lo confirma.
Despacho: a todo Chile. Los costos y plazos dependen del destino y están publicados en ${SITIO_WEB}; no inventes valores.
Medios de pago: tarjetas de débito y crédito, transferencias, abonos y saldos contra entrega.
Cambios y devoluciones: según la política publicada en ${SITIO_WEB}.
Promociones vigentes:
- Por la compra de lentes ópticos multifocales o progresivos, de regalo unas gafas de sol ópticas para visión de lejos.
- Solo para ópticas (profesionales): pantalla LED de optotipo a $49.900 con IVA incluido (precio normal $79.900). Incluye 1 año de página web y 2 correos corporativos pagando solo el hosting: 1 UF al año. Es para las primeras 20 unidades. Si preguntan por esta promo, ofrece que una persona del equipo continúe la conversación.
Para comprar un producto, el cliente puede hacerlo directamente en ${SITIO_WEB}. Si pide ver ejemplos de monturas, puedes ofrecerle las fotos del catálogo visual.`;

async function main() {
  const antes = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!antes) throw new Error('No existe la Empresa con ese id -- no se toca nada.');
  if (!/luxvision/i.test(antes.nombre)) throw new Error(`El nombre no calza (${antes.nombre}) -- no se toca nada.`);
  if (!String(antes.whatsappPhoneNumber || '').replace(/\D/g, '').endsWith(NUMERO_ESPERADO)) {
    throw new Error(`El WhatsApp de esta Empresa no es el esperado (${antes.whatsappPhoneNumber}) -- no se toca nada.`);
  }

  // Respaldo en pantalla de lo que se va a reemplazar (queda en el historial de la
  // terminal por si hubiera que recuperar algo del texto anterior).
  console.log('--- TEXTO ANTERIOR (informacionAdicional) ---');
  console.log(antes.informacionAdicional || '(vacío)');
  console.log(`--- DIRECCIÓN ANTERIOR: ${antes.direccion || '(vacía)'} ---\n`);

  const datos = {
    direccion: DIRECCION,
    sitioWeb: SITIO_WEB,
    informacionAdicional: INFORMACION_ADICIONAL,
    catalogoVisualActivo: true,
    esDemo: false,
  };
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: datos });

  console.log(`✅ "${antes.nombre}" configurada.`);
  console.log(`  esDemo: ${antes.esDemo} -> false | catalogoVisualActivo: ${antes.catalogoVisualActivo} -> true`);
  console.log(`  direccion: ${antes.direccion ? 'tenía una (reemplazada)' : 'vacía'} -> "${DIRECCION}"`);
  console.log(`  sitioWeb: ${antes.sitioWeb || 'vacío'} -> ${SITIO_WEB}`);
  console.log(`  informacionAdicional: ${antes.informacionAdicional ? antes.informacionAdicional.length + ' caracteres (reemplazada)' : 'vacía'} -> ${INFORMACION_ADICIONAL.length} caracteres`);

  const servicios = await prisma.servicio.findMany({ where: { empresaId: EMPRESA_ID }, select: { nombre: true, activo: true } });
  const recursos = await prisma.recursoAgendable.findMany({ where: { empresaId: EMPRESA_ID }, select: { nombre: true } });
  const categorias = await prisma.catalogoCategoria.findMany({ where: { empresaId: EMPRESA_ID }, include: { _count: { select: { items: true } } } });
  console.log(`\nServicios cargados (${servicios.length}): ${servicios.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(' | ') || '(ninguno: el bot usaría la lista genérica del rubro, conviene cargar el examen visual en el panel)'}`);
  console.log(`Profesionales/recursos agendables (${recursos.length}): ${recursos.map((r) => r.nombre).join(' | ') || '(ninguno)'}`);
  console.log(`Categorías del catálogo visual (${categorias.length}): ${categorias.map((c) => `${c.nombre} (${c._count.items} fotos)`).join(' | ') || '(ninguna todavía)'}`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
