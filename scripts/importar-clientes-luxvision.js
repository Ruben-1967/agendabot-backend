#!/usr/bin/env node
// Importa clientes históricos desde un archivo CSV con columnas:
// fecha;nombre;telefono  (o separadas por coma, se detecta solo)
//
// El "fecha" se guarda como fichaJson.receta.fecha, que es lo que usa
// el cron de recordatorios (src/jobs/enviarRecordatorios.js) para saber
// a quién le corresponde el recordatorio de control anual.
//
// USO:
//   node scripts/importar-clientes-luxvision.js ruta/al/archivo.csv

require('dotenv').config();
const fs = require('fs');
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'luxvision-seed-id';

/**
 * Normaliza un teléfono chileno al formato internacional que usa el
 * resto del sistema (ej. "956035664" -> "56956035664").
 */
function normalizarTelefono(raw) {
  const digitos = String(raw).replace(/\D/g, '');

  if (digitos.length === 9 && digitos.startsWith('9')) {
    return '56' + digitos;
  }
  if (digitos.length === 11 && digitos.startsWith('56')) {
    return digitos;
  }

  console.warn(`Teléfono con formato inesperado, se deja tal cual: "${raw}" -> "${digitos}"`);
  return digitos;
}

/**
 * Convierte "DD-MM-YYYY" a "YYYY-MM-DD" (formato seguro para new Date()).
 */
function convertirFecha(ddmmyyyy) {
  const partes = ddmmyyyy.trim().split(/[-/]/);
  if (partes.length !== 3) {
    throw new Error(`Fecha con formato inesperado: "${ddmmyyyy}" (se esperaba DD-MM-YYYY)`);
  }
  const [d, m, y] = partes;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Parser simple de CSV: soporta campos entre comillas (por si algún
 * nombre trae coma adentro), y detecta automáticamente si el separador
 * es coma (,) o punto y coma (;) — Excel en español suele exportar con ";".
 */
function parsearCSV(contenido) {
  const lineas = contenido.trim().split('\n').filter((l) => l.trim().length > 0);
  const encabezado = lineas[0];
  const separador =
    (encabezado.match(/;/g) || []).length >= (encabezado.match(/,/g) || []).length ? ';' : ',';

  const filas = lineas.slice(1); // saltar encabezado

  return filas
    .map((linea, i) => {
      const columnas = linea.split(separador).map((v) => v.trim().replace(/^"|"$/g, ''));
      const [fecha, nombre, telefono] = columnas;

      if (!fecha || !nombre || !telefono) {
        console.warn(`Fila ${i + 2} incompleta, se omite: "${linea}"`);
        return null;
      }

      return { fecha, nombre, telefono };
    })
    .filter(Boolean);
}

async function importar(rutaArchivo) {
  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(`No se encontró el archivo: ${rutaArchivo}`);
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) {
    throw new Error(`No existe la empresa con id ${EMPRESA_ID}. Corre el seed primero.`);
  }

  const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
  const filas = parsearCSV(contenido);

  console.log(`Se encontraron ${filas.length} filas válidas para importar.\n`);

  let creados = 0;
  let actualizados = 0;
  let errores = 0;

  for (const fila of filas) {
    try {
      const telefono = normalizarTelefono(fila.telefono);
      const fechaISO = convertirFecha(fila.fecha);

      const existente = await prisma.cliente.findFirst({
        where: { empresaId: EMPRESA_ID, telefono },
      });

      if (existente) {
        await prisma.cliente.update({
          where: { id: existente.id },
          data: {
            nombre: fila.nombre,
            fichaJson: { receta: { fecha: fechaISO } },
          },
        });
        actualizados++;
      } else {
        await prisma.cliente.create({
          data: {
            empresaId: EMPRESA_ID,
            nombre: fila.nombre,
            telefono,
            fichaJson: { receta: { fecha: fechaISO } },
          },
        });
        creados++;
      }
    } catch (err) {
      errores++;
      console.error(`Error con la fila de "${fila.nombre}":`, err.message);
    }
  }

  console.log(
    `\nImportación completa: ${creados} clientes nuevos, ${actualizados} actualizados, ${errores} con error.`
  );
}

const rutaArchivo = process.argv[2];

if (!rutaArchivo) {
  console.log('Uso: node scripts/importar-clientes-luxvision.js ruta/al/archivo.csv');
  process.exit(1);
}

importar(rutaArchivo)
  .catch((err) => {
    console.error('Error general:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());