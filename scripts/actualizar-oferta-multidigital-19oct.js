#!/usr/bin/env node
/**
 * Actualiza en la Empresa "Multidigital" (la del WhatsApp de anuncios) cómo el bot describe
 * la oferta de entrada, según lo aprobado el 2026-10-19:
 *   - ya no es "landing" sino un sitio web de una página con hasta 7 secciones;
 *   - se suma el plan anual: $95.000 + IVA al año (20% menos, ahorra $23.800).
 * Incluye la permanencia definida el 19-oct: sin permanencia, baja libre; el sitio deja de publicarse y hosting/correos siguen hasta 1 año desde la contratación. Solo reemplaza esas frases exactas dentro
 * de informacionAdicional; no toca nada más ni manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/actualizar-oferta-multidigital-19oct.js
 *   APLICAR=1 node scripts/actualizar-oferta-multidigital-19oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const CAMBIOS = [
  {
    antes: 'página web (landing) a la medida con 2 correos corporativos @tuempresa.cl',
    despues: 'sitio web de una página a la medida (hasta 7 secciones: inicio, servicios y precios, promociones, quiénes somos, ubicación con mapa, preguntas frecuentes y redes) con 2 correos corporativos @tuempresa.cl',
  },
  {
    antes: 'Valor: $9.900 al mes + IVA.',
    despues: 'Valor: $9.900 al mes + IVA, o pago anual de $95.000 + IVA al año (20% menos: ahorra $23.800, equivale a $7.917 al mes + IVA). Sin permanencia: puede darse de baja cuando quiera; si se va, el sitio deja de publicarse, pero el hosting y los correos siguen activos hasta completar 1 año desde la contratación. No incluye tienda online, selector de lentes ni prueba virtual: eso es aparte.',
  },
];

async function main() {
  const aplicar = process.env.APLICAR === '1';
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital -- no se hace nada.');
  let texto = e.informacionAdicional || '';
  let pendientes = 0;
  for (const c of CAMBIOS) {
    const veces = texto.split(c.antes).length - 1;
    const yaAplicado = texto.includes(c.despues);
    console.log(`- "${c.antes.slice(0, 60)}...": ${veces} ocurrencia(s)${yaAplicado ? ' (ya aplicado)' : ''}`);
    if (veces === 1) { texto = texto.split(c.antes).join(c.despues); pendientes++; }
    else if (veces > 1) throw new Error('Una frase aparece más de una vez: se revisa a mano, no se cambia nada.');
  }
  if (!pendientes) { console.log('Nada que cambiar.'); return; }
  if (!aplicar) { console.log(`\nDRY-RUN: se cambiarían ${pendientes} frase(s). Para aplicar: APLICAR=1`); return; }
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: texto } });
  console.log(`✅ informacionAdicional de Multidigital actualizado (${pendientes} frase(s)).`);
}

main()
  .catch((err) => { console.error('❌ Error:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
