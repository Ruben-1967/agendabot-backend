#!/usr/bin/env node
/**
 * Corrige lo que responde el bot de Multidigital cuando preguntan "¿qué servicios ofrecen?"
 * (2026-10-20). Hoy la Empresa no tiene Servicios reales, así que el bot usa la lista genérica
 * del rubro "Creatividad / Marketing" (Sesión de diseño, Consultoría de marca, Producción de
 * contenido, Reunión de seguimiento), que no es lo que vende Multidigital.
 *
 * Qué hace:
 *   1) Crea UN Servicio real: "Sitio web de una página + 2 correos corporativos" (la oferta
 *      de los anuncios). Con exactamente 1 servicio real el bot lo nombra en texto plano, no
 *      ofrece selector ni intenta agendar nada.
 *   2) Amplía informacionAdicional con el catálogo completo de lo que ofrece Multidigital
 *      (tomado de las tarjetas del sitio), para que el bot lo cite cuando pregunten por un
 *      producto puntual. Reemplaza solo la línea "Otros servicios: ...".
 * No toca el rubro (otras empresas lo usan), no manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_cargar-servicio-multidigital-20oct.js
 *   APLICAR=1 node scripts/_cargar-servicio-multidigital-20oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const NOMBRE_SERVICIO = 'Sitio web de una página + 2 correos corporativos';

const ANTES = 'Otros servicios: TotemSystem (asistente de agendamiento por WhatsApp con inteligencia artificial, desde $14.900 al mes + IVA), materiales gráficos y comercio electrónico. Para detalles o cotizaciones de cualquiera de ellos, una persona del equipo continúa la conversación.';
const DESPUES = `Catálogo de Multidigital (puedes citarlo si preguntan por un producto en particular):
- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.
- TotemSystem, WhatsApp con IA: asistente que agenda, atiende y vende por WhatsApp las 24 horas, adaptado al rubro del negocio. Desde $14.900 al mes + IVA.
- OpticSelector: selector de cristales inteligente para la tienda online de una óptica, con carga de recetas, prueba virtual de monturas y cotización en el momento.
- CristalView: muestra al cliente cómo se verán sus cristales según su receta, para que entienda el grosor y decida con confianza.
- E-Commerce para ópticas: plataforma web diseñada para el sector óptico, con el respaldo de LuxVision.
- Norman Care: recordatorio de medicamentos con confirmación por foto; si la persona no confirma, se avisa al cuidador por WhatsApp. Tiene plan gratis.
- Materiales gráficos: afiches, banners, logotipos y plantillas profesionales para campañas.
Solo el sitio web + correos y TotemSystem tienen precio indicado aquí. Para precios, detalles o cotizaciones de cualquier otro producto, una persona del equipo continúa la conversación.`;

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const e = await prisma.empresa.findUnique({
    where: { id: EMPRESA_ID },
    select: { nombre: true, informacionAdicional: true, servicios: { select: { id: true, nombre: true, activo: true } } },
  });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');

  console.log('Servicios actuales de la Empresa:', e.servicios.length ? e.servicios.map((s) => `${s.nombre}${s.activo ? '' : ' [inactivo]'}`).join(' | ') : '(ninguno -> el bot usa la lista genérica del rubro)');

  const yaTieneServicio = e.servicios.some((s) => s.nombre === NOMBRE_SERVICIO);
  const otrosActivos = e.servicios.filter((s) => s.activo && s.nombre !== NOMBRE_SERVICIO);
  if (otrosActivos.length) console.warn(`⚠️  Hay otros servicios activos (${otrosActivos.map((s) => s.nombre).join(', ')}): con 2 o más el bot ofrecería un selector. Revisar antes de aplicar.`);

  const texto = e.informacionAdicional || '';
  const veces = texto.split(ANTES).length - 1;
  const catalogoYa = texto.includes('Catálogo de Multidigital');
  console.log(`Línea "Otros servicios": ${veces} ocurrencia(s)${catalogoYa ? ' | el catálogo ya está cargado' : ''}`);
  console.log(`Servicio "${NOMBRE_SERVICIO}": ${yaTieneServicio ? 'ya existe' : 'se creará'}`);

  const hayCambios = !yaTieneServicio || veces === 1;
  if (veces > 1) throw new Error('La línea "Otros servicios" aparece más de una vez: se revisa a mano, no se cambia nada.');
  if (!hayCambios) { console.log('Nada que cambiar.'); return; }
  if (!aplicar) { console.log('\nDRY-RUN: no se escribió nada. Para aplicar: APLICAR=1'); return; }

  if (!yaTieneServicio) {
    await prisma.servicio.create({ data: { empresaId: EMPRESA_ID, nombre: NOMBRE_SERVICIO, activo: true, requiereProfesionalEspecifico: false } });
    console.log(`✅ Servicio creado: ${NOMBRE_SERVICIO}`);
  }
  if (veces === 1) {
    await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: texto.split(ANTES).join(DESPUES) } });
    console.log('✅ informacionAdicional actualizado con el catálogo.');
  }
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
