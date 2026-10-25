#!/usr/bin/env node
// Prueba del guion de atención de Multidigital (Empresa.guionAtencion) contra el modelo real,
// SIN base de datos: arma en memoria la Empresa con el mismo catálogo y el guion de
// scripts/_guion-atencion-multidigital-23oct.js, y simula conversaciones completas.
// Hace llamadas reales a Anthropic (unos centavos). No manda ningún WhatsApp.
//
// USO (necesita ANTHROPIC_API_KEY, ej. Shell de Render staging):
//   node scripts/_probar-guion-multidigital-23oct.js

require('dotenv').config();
const { generarRespuestaChatbot, saludoSegunHoraChile } = require('../src/services/claude');
const { GUION } = require('./_guion-atencion-multidigital-23oct');

const INFO = `Quiénes somos: Multidigital, empresa chilena de servicios digitales para pymes. Sitio web: https://multidigital.cl
Oferta de entrada: sitio web de una página a la medida (hasta 7 secciones) con 2 correos corporativos @tuempresa.cl. Valor: $9.900 al mes + IVA, o pago anual de $95.000 + IVA al año. Sin permanencia.
Catálogo de Multidigital:
- Sitio web de una página + 2 correos corporativos: la oferta de entrada.
- TotemSystem, WhatsApp con IA: agenda, atiende y vende por WhatsApp las 24 horas. Desde $14.900 al mes + IVA.
- OpticSelector: selector de cristales para la tienda online de una óptica.
- CristalView: muestra cómo se verán los cristales según la receta.
- E-Commerce para ópticas: plataforma web para el sector óptico.
- Norman Care: recordatorio de medicamentos con confirmación por foto. Tiene plan gratis.
- Materiales gráficos: afiches, banners, logotipos y plantillas.`;

const empresa = {
  id: 'prueba-multidigital-en-memoria', nombre: 'Multidigital', sucursal: null, sitioWeb: 'https://multidigital.cl',
  direccion: null, tonoComunicacion: 'Neutral', modoInformativo: true, informacionAdicional: INFO, requiereRut: false,
  guionAtencion: GUION,
};
const cliente = { id: 'cliente-prueba', nombre: null };
const CATALOGO = /TotemSystem|OpticSelector|CristalView|Norman Care/i;
const VOSEO_O_USTED = /\b(vos|tenés|querés|podés|usted)\b/i;

let fallas = 0;
function verificar(descripcion, condicion, detalle) {
  console.log(`${condicion ? '✅' : '❌'} ${descripcion}${condicion ? '' : `  -> ${detalle}`}`);
  if (!condicion) fallas++;
}

// Simula una conversación: devuelve la última respuesta y el historial completo.
async function conversar(mensajes) {
  const historial = [];
  let r;
  for (const m of mensajes) {
    r = await generarRespuestaChatbot({ empresa, cliente, historial: [...historial], mensajeEntrante: m, reservaEnCurso: null });
    console.log(`  > ${m}\n  < ${r.texto}${r.escaladoAHumano ? '  [DERIVA A PERSONA]' : ''}`);
    historial.push({ rol: 'usuario', contenido: m }, { rol: 'asistente', contenido: r.texto });
    if (r.escaladoAHumano) break;
  }
  return { r, historial };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en el entorno.');
  const saludo = saludoSegunHoraChile();

  console.log('\n1) Saludo simple');
  let { r } = await conversar(['Hola']);
  verificar(`abre con "${saludo}" y como el equipo de Multidigital`, r.texto.includes(saludo) && /equipo de Multidigital/i.test(r.texto), r.texto);
  verificar('ofrece ejemplo sin costo o llamada', /ejemplo/i.test(r.texto) && /llam/i.test(r.texto), r.texto);
  verificar('el saludo ya da el precio ($9.900 + IVA) y el hosting', /9\.900/.test(r.texto) && /IVA/i.test(r.texto) && /hosting/i.test(r.texto), r.texto);
  verificar('NO muestra el catálogo', !CATALOGO.test(r.texto), r.texto);
  verificar('no deriva todavía', !r.escaladoAHumano, '');

  console.log('\n2) Mensaje automático del anuncio');
  ({ r } = await conversar(['¡Hola! Quiero más información sobre el sitio web + 2 correos.']));
  verificar('responde con la apertura, sin catálogo', /ejemplo/i.test(r.texto) && !CATALOGO.test(r.texto), r.texto);

  console.log('\n3) Camino del ejemplo, completo');
  ({ r } = await conversar(['Hola', 'El ejemplo', 'Es una peluquería, se llama Estilo Ana', 'Me llamo Ana y estamos en Puerto Montt']));
  verificar('al tener los datos deriva a una persona', r.escaladoAHumano === true, r.texto);
  verificar('cierre con el nombre y "durante el día"', /Ana/.test(r.texto) && /durante el d[ií]a/i.test(r.texto), r.texto);

  console.log('\n4) Camino de la llamada');
  const llamada = await conversar(['Buenas', 'Prefiero que me llamen', 'Tengo un taller mecánico, Taller Rojas', 'Soy Pedro, de Rancagua', 'En la tarde, después de las 15:00']);
  const pidioHorario = llamada.historial.some((m) => m.rol === 'asistente' && /horario|hora/i.test(m.contenido));
  verificar('pregunta en qué horario llamarlo', pidioHorario, '');
  verificar('termina derivando a una persona', llamada.r.escaladoAHumano === true, llamada.r.texto);
  verificar('el cierre habla de la llamada en su horario (no "durante el día por este chat")', /Pedro/.test(llamada.r.texto) && /llamamos/i.test(llamada.r.texto) && /horario/i.test(llamada.r.texto), llamada.r.texto);

  console.log('\n5) Pregunta el precio en medio del guion');
  ({ r } = await conversar(['Hola', '¿Cuánto cuesta?']));
  verificar('da $9.900 + IVA', /9\.900/.test(r.texto) && /IVA/i.test(r.texto), r.texto);
  verificar('no deriva por preguntar el precio', !r.escaladoAHumano, '');
  verificar('menciona la promo del hosting (50% hasta el 31 de octubre)', /50\s?%/.test(r.texto) && /31 de octubre/i.test(r.texto), r.texto);

  console.log('\n6) Pide hablar con una persona');
  ({ r } = await conversar(['Hola', 'Quiero hablar con una persona']));
  verificar('deriva de inmediato', r.escaladoAHumano === true, r.texto);

  console.log('\n7) Pregunta por otros productos');
  ({ r } = await conversar(['Hola', '¿Qué otros servicios tienen?']));
  verificar('ahí sí lista el catálogo', CATALOGO.test(r.texto), r.texto);

  console.log('\n8) No le interesa');
  ({ r } = await conversar(['Hola', 'No, gracias, no me interesa']));
  verificar('agradece sin derivar ni insistir', !r.escaladoAHumano && !/ejemplo/i.test(r.texto), r.texto);

  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron.` : '\n✅ Todas las verificaciones pasaron.');
  process.exitCode = fallas ? 1 : 0;
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
