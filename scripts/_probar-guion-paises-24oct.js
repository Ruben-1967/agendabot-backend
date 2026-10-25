#!/usr/bin/env node
// Prueba del guion de Multidigital para personas de Perú y Colombia (anuncios por país,
// 2026-10-24) contra el modelo real, SIN base de datos: misma Empresa en memoria que
// scripts/_probar-guion-multidigital-23oct.js, cambiando solo el teléfono del cliente.
// Los teléfonos son fijos y ficticios (no se usan para nada: no se manda ningún WhatsApp).
// Hace llamadas reales a Anthropic (unos centavos).
//
// USO (necesita ANTHROPIC_API_KEY, ej. Shell de Render staging):
//   node scripts/_probar-guion-paises-24oct.js

require('dotenv').config();
const { generarRespuestaChatbot, saludoSegunHoraChile } = require('../src/services/claude');
const { GUION } = require('./_guion-atencion-multidigital-23oct');

const INFO = `Quiénes somos: Multidigital, empresa chilena de servicios digitales para pymes. Sitio web: https://multidigital.cl
Oferta de entrada: sitio web de una página a la medida (hasta 7 secciones) con 2 correos corporativos @tuempresa.cl. Valor: $9.900 al mes + IVA, o pago anual de $95.000 + IVA al año. Sin permanencia.
Catálogo de Multidigital:
- Sitio web de una página + 2 correos corporativos: la oferta de entrada.
- TotemSystem, WhatsApp con IA: agenda, atiende y vende por WhatsApp las 24 horas. Desde $14.900 al mes + IVA.
- Materiales gráficos: afiches, banners, logotipos y plantillas.`;

const empresa = {
  id: 'prueba-multidigital-en-memoria', nombre: 'Multidigital', sucursal: null, sitioWeb: 'https://multidigital.cl',
  direccion: null, tonoComunicacion: 'Neutral', modoInformativo: true, informacionAdicional: INFO, requiereRut: false,
  guionAtencion: GUION,
};
const TEL_PERU = '51900000001';
const TEL_COLOMBIA = '573000000001';
const TEL_CHILE = '56900000001';
// "$9.900" sí, pero no "$39.900" (precio de Colombia).
// "IVA" como palabra: si no, calza dentro de "deriva".
const PRECIO_CHILENO = /\$\s?9\.900|95\.000|\bIVA\b|\bUF\b|31 de octubre|50\s?%/i;

let fallas = 0;
function verificar(descripcion, condicion, detalle) {
  console.log(`${condicion ? '✅' : '❌'} ${descripcion}${condicion ? '' : `  -> ${detalle}`}`);
  if (!condicion) fallas++;
}

async function conversar(telefono, mensajes) {
  const cliente = { id: 'cliente-prueba', nombre: null, telefono };
  const historial = [];
  let r;
  for (const m of mensajes) {
    r = await generarRespuestaChatbot({ empresa, cliente, historial: [...historial], mensajeEntrante: m, reservaEnCurso: null, canal: 'whatsapp' });
    console.log(`  > ${m}\n  < ${r.texto}${r.escaladoAHumano ? '  [DERIVA A PERSONA]' : ''}`);
    historial.push({ rol: 'usuario', contenido: m }, { rol: 'asistente', contenido: r.texto });
    if (r.escaladoAHumano) break;
  }
  return { r, historial };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en el entorno.');

  console.log('\n1) Perú: saludo con la hora de Lima');
  let { r } = await conversar(TEL_PERU, ['Hola']);
  const saludoLima = saludoSegunHoraChile(new Date(), 'America/Lima');
  verificar(`abre con "${saludoLima}" y ofrece ejemplo o llamada`, r.texto.includes(saludoLima) && /ejemplo/i.test(r.texto), r.texto);
  verificar('el saludo ya da S/ 39 y el hosting S/ 149, sin precios chilenos', /S\/\s?39\b/.test(r.texto) && /S\/\s?149\b/.test(r.texto) && !PRECIO_CHILENO.test(r.texto), r.texto);

  console.log('\n2) Perú: pregunta el precio');
  ({ r } = await conversar(TEL_PERU, ['Hola', '¿Cuánto cuesta?']));
  verificar('NO da precios chilenos, IVA, UF ni la promo', !PRECIO_CHILENO.test(r.texto), r.texto);
  verificar('da S/ 39 al mes, sin "desde"', /S\/\s?39\b/.test(r.texto) && !/desde/i.test(r.texto), r.texto);
  verificar('no deriva por preguntar el precio', !r.escaladoAHumano, '');

  console.log('\n2b) Perú: pregunta por el hosting y el dominio');
  ({ r } = await conversar(TEL_PERU, ['Hola', '¿Cuánto cuesta?', '¿Y el hosting y el dominio?']));
  verificar('hosting S/ 149 al año y dominio .pe aparte', /S\/\s?149\b/.test(r.texto) && /\.pe\b/i.test(r.texto), r.texto);
  verificar('NO da precios chilenos', !PRECIO_CHILENO.test(r.texto), r.texto);

  console.log('\n2c) Colombia: pregunta el precio');
  ({ r } = await conversar(TEL_COLOMBIA, ['Hola', '¿Qué precio tiene?']));
  verificar('da $39.900 COP al mes, sin "desde"', /39\.900/.test(r.texto) && /COP/.test(r.texto) && !/desde/i.test(r.texto), r.texto);
  verificar('NO da precios chilenos', !PRECIO_CHILENO.test(r.texto), r.texto);

  console.log('\n3) Colombia: camino del ejemplo, completo');
  const col = await conversar(TEL_COLOMBIA, ['Buenas', 'El ejemplo', 'Tengo una panadería, se llama Pan de Yuca Doña Rosa', 'Soy Rosa, estamos en Medellín']);
  verificar('deriva a una persona con el cierre y su nombre', col.r.escaladoAHumano === true && /Rosa/.test(col.r.texto), col.r.texto);
  verificar('en toda la conversación no aparece "comuna" ni precios chilenos',
    !col.historial.some((m) => m.rol === 'asistente' && (/comuna/i.test(m.contenido) || PRECIO_CHILENO.test(m.contenido))), '');

  console.log('\n4) Colombia: ¿atienden en Colombia?');
  ({ r } = await conversar(TEL_COLOMBIA, ['Hola']));
  verificar('el saludo de Colombia da $39.900 COP y el hosting $149.000 COP', /39\.900/.test(r.texto) && /149\.000/.test(r.texto) && !PRECIO_CHILENO.test(r.texto), r.texto);
  ({ r } = await conversar(TEL_COLOMBIA, ['Hola', '¿Ustedes trabajan con clientes en Colombia?']));
  verificar('dice que sí, 100% online', /online|en l[ií]nea|remot/i.test(r.texto), r.texto);

  console.log('\n5) Chile sigue igual: da el precio');
  ({ r } = await conversar(TEL_CHILE, ['Hola', '¿Cuánto cuesta?']));
  verificar('da $9.900 + IVA', /9\.900/.test(r.texto) && /IVA/i.test(r.texto), r.texto);

  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron.` : '\n✅ Todas las verificaciones pasaron.');
  process.exitCode = fallas ? 1 : 0;
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; });
