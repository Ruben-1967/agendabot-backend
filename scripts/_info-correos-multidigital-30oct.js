#!/usr/bin/env node
/**
 * Agrega a la información del negocio de Multidigital qué tipo de correos incluye el plan
 * (2026-10-30). En la prueba Haiku vs Sonnet con conversaciones reales, a la pregunta "¿los
 * correos son de Gmail? ¿Workspace?" Sonnet improvisaba y Haiku derivaba a una persona,
 * porque el dato no estaba en informacionAdicional.
 *
 * Solo agrega el párrafo si no está; no toca nada más, no manda mensajes. DRY-RUN por defecto.
 *
 * Uso (Shell de Render, producción):
 *   node scripts/_info-correos-multidigital-30oct.js
 *   APLICAR=1 node scripts/_info-correos-multidigital-30oct.js
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const MARCA = 'Sobre los 2 correos corporativos:';
const PARRAFO = `${MARCA} son cuentas con el dominio propio del cliente (por ejemplo contacto@suempresa.cl), alojadas en nuestro servidor; no son Gmail ni Google Workspace y no tienen costo de licencia aparte. Se pueden leer y enviar desde la app de Gmail o de Outlook en el celular o el computador, o desde el correo web, y nosotros dejamos todo configurado.`;

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID }, select: { nombre: true, informacionAdicional: true } });
  if (!empresa) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
  const actual = empresa.informacionAdicional || '';
  console.log(`Empresa: ${empresa.nombre} · información actual: ${actual.length} caracteres`);
  if (actual.includes(MARCA)) {
    console.log('El párrafo de los correos ya está. No hay nada que hacer.');
    return;
  }
  console.log(`Se agregaría al final:\n\n${PARRAFO}\n`);
  if (process.env.APLICAR !== '1') {
    console.log('DRY-RUN: no se guardó nada. Para aplicar: APLICAR=1 node scripts/_info-correos-multidigital-30oct.js');
    return;
  }
  await prisma.empresa.update({ where: { id: EMPRESA_ID }, data: { informacionAdicional: `${actual.trimEnd()}\n\n${PARRAFO}` } });
  console.log('✅ Guardado.');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
