#!/usr/bin/env node
/**
 * Importa la base de pacientes de LuxVision (ya limpia/transformada, ver
 * scratchpad/luxvision_clientes.json) como Cliente reales. Usa el mismo
 * `prisma` compartido de src/lib/prisma.js -- cifra Cliente.rut
 * automáticamente, igual que cualquier otra ruta del backend.
 *
 * Idempotente: si un RUT o teléfono ya existe como Cliente de esta Empresa,
 * se salta esa fila en vez de duplicarla -- permite reintentar sin miedo si
 * algo falla a mitad de camino.
 *
 * Decisión 2026-09-06: el negocio pidió explícitamente que el recordatorio
 * de control anual no empiece a dispararse hasta el 21 de septiembre. Como
 * enviarRecordatorios.js solo mira `fichaJson.receta.fecha`, acá se importa
 * la fecha real bajo OTRA clave (`fechaVisitaImportada`) para que el job no
 * la vea todavía -- ver scripts/activar-recordatorios-luxvision.js, que hay
 * que correr el 21 (o después) para "activarla" de verdad.
 *
 * Uso:
 *   EMPRESA_ID=<id> ARCHIVO=<ruta al json> node scripts/importar-clientes-luxvision.js
 */
require('dotenv').config();
const fs = require('fs');
const prisma = require('../src/lib/prisma');

const empresaId = process.env.EMPRESA_ID;
const archivo = process.env.ARCHIVO;

if (!empresaId || !archivo) {
  console.error('Uso: EMPRESA_ID=<id> ARCHIVO=<ruta al json> node scripts/importar-clientes-luxvision.js');
  process.exit(1);
}

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } });
  if (!empresa) {
    console.error('No se encontró ninguna Empresa con id:', empresaId);
    process.exit(1);
  }
  console.log('Empresa encontrada:', empresa.nombre);

  const clientesAImportar = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  console.log(`Registros en el archivo: ${clientesAImportar.length}`);

  // Trae los clientes ya existentes de esta empresa (findMany descifra el
  // rut automáticamente) para no duplicar en un reintento.
  const existentes = await prisma.cliente.findMany({
    where: { empresaId },
    select: { rut: true, telefono: true },
  });
  const rutsExistentes = new Set(existentes.filter((c) => c.rut).map((c) => c.rut));
  const telefonosExistentes = new Set(existentes.filter((c) => c.telefono).map((c) => c.telefono));

  let creados = 0, saltados = 0, errores = 0;

  for (const c of clientesAImportar) {
    const yaExiste = (c.rut && rutsExistentes.has(c.rut)) || (c.telefono && telefonosExistentes.has(c.telefono));
    if (yaExiste) {
      saltados++;
      continue;
    }
    // Oculta la fecha de receta bajo otra clave -- enviarRecordatorios.js
    // solo lee fichaJson.receta.fecha, así que mientras no exista esa
    // clave exacta, este cliente nunca dispara el recordatorio.
    let fichaJson = c.fichaJson || undefined;
    if (fichaJson?.receta?.fecha) {
      const { receta, ...resto } = fichaJson;
      fichaJson = { ...resto, fechaVisitaImportada: receta.fecha };
    }

    try {
      await prisma.cliente.create({
        data: {
          empresaId,
          nombre: c.nombre,
          rut: c.rut || undefined,
          telefono: c.telefono || undefined,
          fichaJson,
          // Base histórica importada -- todavía sin consentimiento explícito
          // de marketing (ver conversación 2026-09-05/06), así que no
          // participan de campañas hasta que se resuelva el opt-in.
          optInCampanas: false,
        },
      });
      if (c.rut) rutsExistentes.add(c.rut);
      if (c.telefono) telefonosExistentes.add(c.telefono);
      creados++;
    } catch (err) {
      errores++;
      console.error(`Error creando "${c.nombre}":`, err.message);
    }
  }

  console.log(`\nResultado: creados=${creados} saltados_ya_existian=${saltados} errores=${errores}`);
}

main()
  .catch((error) => {
    console.error('Error inesperado:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
