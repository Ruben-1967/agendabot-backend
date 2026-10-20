#!/usr/bin/env node
// Prueba del modo informativo (Empresa.modoInformativo) contra el modelo real, SIN base de
// datos: arma en memoria una Empresa "Multidigital" y le hace preguntas al bot. Verifica que
// (1) liste el catálogo completo, (2) dé los precios que figuran, (3) derive a una persona al
// pedirlo, (4) no intente agendar ni muestre listas, (5) no invente precios de lo que no los
// tiene. Hace llamadas reales a Anthropic (unos pocos centavos). No manda ningún WhatsApp.
//
// USO: node scripts/_probar-modo-informativo-20oct.js

require('dotenv').config();
const { generarRespuestaChatbot } = require('../src/services/claude');

const INFO = `Esta es la ÚNICA información que puedes citar sobre Multidigital. Si te preguntan algo que no está aquí (condiciones del contrato, plazos de entrega, precios de otros servicios), NO lo inventes: dile que una persona del equipo se lo confirma y ofrece que continúe la conversación.
Quiénes somos: Multidigital, empresa chilena de servicios digitales para pymes. Sitio web: https://multidigital.cl
Oferta de entrada: sitio web de una página a la medida (hasta 7 secciones: inicio, servicios y precios, promociones, quiénes somos, ubicación con mapa, preguntas frecuentes y redes) con 2 correos corporativos @tuempresa.cl. Valor: $9.900 al mes + IVA, o pago anual de $95.000 + IVA al año (20% menos). Sin permanencia: puede darse de baja cuando quiera. No incluye tienda online, selector de lentes ni prueba virtual: eso es aparte. El hosting cuesta 1 UF al año (+ IVA); el primer año tiene 50% de descuento.
Catálogo de Multidigital (puedes citarlo si preguntan por un producto en particular):
- Sitio web de una página + 2 correos corporativos: la oferta de entrada, con el precio indicado arriba.
- TotemSystem, WhatsApp con IA: asistente que agenda, atiende y vende por WhatsApp las 24 horas, adaptado al rubro del negocio. Desde $14.900 al mes + IVA.
- OpticSelector: selector de cristales inteligente para la tienda online de una óptica, con carga de recetas, prueba virtual de monturas y cotización en el momento.
- CristalView: muestra al cliente cómo se verán sus cristales según su receta, para que entienda el grosor y decida con confianza.
- E-Commerce para ópticas: plataforma web diseñada para el sector óptico, con el respaldo de LuxVision.
- Norman Care: recordatorio de medicamentos con confirmación por foto; si la persona no confirma, se avisa al cuidador por WhatsApp. Tiene plan gratis.
- Materiales gráficos: afiches, banners, logotipos y plantillas profesionales para campañas.
Solo el sitio web + correos y TotemSystem tienen precio indicado aquí. Para precios, detalles o cotizaciones de cualquier otro producto, una persona del equipo continúa la conversación.`;

const empresa = {
  id: 'prueba-multidigital-en-memoria',
  nombre: 'Multidigital',
  sucursal: null,
  sitioWeb: 'https://multidigital.cl',
  direccion: null,
  tonoComunicacion: 'Neutral',
  modoInformativo: true,
  informacionAdicional: INFO,
  requiereRut: false,
};
const cliente = { id: 'cliente-prueba', nombre: 'Cliente Prueba' };

let fallas = 0;
function verificar(descripcion, condicion, detalle) {
  console.log(`${condicion ? '✅' : '❌'} ${descripcion}${condicion ? '' : `  -> ${detalle}`}`);
  if (!condicion) fallas++;
}
async function preguntar(texto, historial = []) {
  const r = await generarRespuestaChatbot({ empresa, cliente, historial, mensajeEntrante: texto, reservaEnCurso: null });
  console.log(`\n> "${texto}"\n${r.texto}${r.escaladoAHumano ? '  [ESCALA A HUMANO]' : ''}`);
  return r;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en el entorno local.');

  let r = await preguntar('¿Qué servicios ofrecen?');
  const claves = ['TotemSystem', 'OpticSelector', 'CristalView', 'Norman', 'sitio web', 'gráficos'];
  const mencionadas = claves.filter((k) => new RegExp(k, 'i').test(r.texto));
  verificar(`lista el catálogo (menciona ${mencionadas.length}/${claves.length})`, mencionadas.length >= 5, `solo ${mencionadas.join(', ')}`);
  verificar('sin lista interactiva', r.interactivo === null, JSON.stringify(r.interactivo));
  verificar('no menciona los servicios genéricos del rubro', !/sesión de diseño|consultor[ií]a de marca|producción de contenido|reunión de seguimiento/i.test(r.texto), r.texto);

  r = await preguntar('¿Cuánto cuesta el sitio web?');
  verificar('da el precio $9.900 + IVA', /9\.900/.test(r.texto) && /IVA/i.test(r.texto), r.texto);

  r = await preguntar('¿Cuánto cuesta OpticSelector?');
  verificar('no inventa un precio para OpticSelector', !/OpticSelector[^.\n]{0,80}\$\s?\d/i.test(r.texto) && /equipo|persona/i.test(r.texto), r.texto);

  r = await preguntar('Quiero agendar una hora');
  verificar('no intenta agendar ni pide día/hora', !/qué día|qué hora|horarios? disponibles|disponibilidad/i.test(r.texto) && r.interactivo === null, r.texto);

  r = await preguntar('Quiero hablar con una persona');
  verificar('deriva a una persona (pausa la conversación)', r.escaladoAHumano === true, JSON.stringify(r));

  r = await preguntar('hola');
  verificar('el saludo responde sin lista interactiva', r.interactivo === null && r.texto.length > 0, r.texto);

  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron.` : '\n✅ Todas las verificaciones pasaron.');
  process.exitCode = fallas ? 1 : 0;
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
