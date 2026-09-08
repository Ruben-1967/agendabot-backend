// src/routes/recordatorioControlAnual.js
//
// Autoservicio para que un ADMIN de una empresa rubro óptica administre el
// recordatorio de control anual (ver jobs/enviarRecordatorios.js) sin
// depender de un script manual — importar su base de pacientes, ver cuántos
// están pendientes, y pausar/activar el envío.
//
// GET   /empresa/recordatorio-control-anual/resumen   -> { pendientes, pausado }
// PATCH /empresa/recordatorio-control-anual/pausado    -> pausar/activar el envío
// POST  /empresa/recordatorio-control-anual/importar   -> cargar base (CSV/XLSX en base64)

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { esElegible } = require('../lib/recordatorioControlAnual');

router.use(requireAuth, requireRole('ADMIN'));

// Restringido a LuxVision a propósito (decisión 2026-09-06, ver AdminLayout.jsx
// que ya esconde el link del menú para cualquier otro negocio) — antes esto
// solo bloqueaba en el frontend, cualquier otro ADMIN podía pegarle directo a
// estos 3 endpoints. Mismo guard ya usado en /empresa/opt-in-marketing y
// /empresa/instagram/conectar.
const EMPRESA_ID_LUXVISION = 'e277ea9e-5793-468c-aa96-e4a2f7457201';
router.use((req, res, next) => {
  if (req.usuario.empresaId !== EMPRESA_ID_LUXVISION) {
    return res.status(403).json({ error: 'El recordatorio de control anual todavía no está disponible para tu negocio.' });
  }
  next();
});

// ------------------------------------------------------------
// GET /empresa/recordatorio-control-anual/resumen
// ------------------------------------------------------------
router.get('/resumen', async (req, res) => {
  try {
    const [empresa, clientes] = await Promise.all([
      prisma.empresa.findUnique({
        where: { id: req.usuario.empresaId },
        select: { recordatorioControlAnualPausado: true },
      }),
      prisma.cliente.findMany({
        where: { empresaId: req.usuario.empresaId },
        select: { telefono: true, fichaJson: true, recordatorioControlAnualEnviadoEn: true },
      }),
    ]);

    const pendientes = clientes.filter(esElegible).length;

    res.json({ pendientes, pausado: empresa.recordatorioControlAnualPausado });
  } catch (error) {
    console.error('Error en GET /empresa/recordatorio-control-anual/resumen:', error);
    res.status(500).json({ error: 'Error al obtener el resumen del recordatorio' });
  }
});

// ------------------------------------------------------------
// PATCH /empresa/recordatorio-control-anual/pausado
// ------------------------------------------------------------
router.patch('/pausado', async (req, res) => {
  try {
    if (typeof req.body.pausado !== 'boolean') {
      return res.status(400).json({ error: 'pausado debe ser true o false' });
    }

    const empresa = await prisma.empresa.update({
      where: { id: req.usuario.empresaId },
      data: { recordatorioControlAnualPausado: req.body.pausado },
      select: { recordatorioControlAnualPausado: true },
    });

    res.json(empresa);
  } catch (error) {
    console.error('Error en PATCH /empresa/recordatorio-control-anual/pausado:', error);
    res.status(500).json({ error: 'Error al actualizar el estado del recordatorio' });
  }
});

// ------------------------------------------------------------
// POST /empresa/recordatorio-control-anual/importar
// ------------------------------------------------------------

// Encabezados esperados (match case-insensitive, sin tildes) -> nombre normalizado.
const ALIAS_COLUMNAS = {
  fecha: 'fecha',
  nombre: 'nombre',
  rut: 'rut',
  telefono: 'telefono',
  fono: 'telefono',
};

function normalizarEncabezado(texto) {
  return String(texto)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// RUT chileno: dígitos + dígito verificador (0-9 o K). Sin puntos ni guión
// intermedio -- se limpian antes de validar. No intenta adivinar RUT mal
// escrito (ver decisión del plan: validar y reportar, no corregir solo).
function normalizarRut(valorCrudo) {
  const limpio = String(valorCrudo).replace(/[.\s]/g, '').toUpperCase();
  const match = limpio.match(/^(\d{6,9})-?([0-9K])$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

// Teléfono móvil chileno: 9 dígitos que empiezan en 9 -> normalizado con
// código de país, mismo formato que usa el resto del sistema ("56912345678").
function normalizarTelefono(valorCrudo) {
  const limpio = String(valorCrudo).replace(/[\s+()-]/g, '');
  const sinCodigoPais = limpio.startsWith('56') ? limpio.slice(2) : limpio;
  if (!/^9\d{8}$/.test(sinCodigoPais)) return null;
  return `56${sinCodigoPais}`;
}

function normalizarFecha(valorCrudo) {
  // xlsx entrega fechas de Excel ya como objeto Date cuando la celda tiene
  // formato de fecha; si es texto, se intenta parsear directo.
  const fecha = valorCrudo instanceof Date ? valorCrudo : new Date(valorCrudo);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().slice(0, 10);
}

router.post('/importar', async (req, res) => {
  try {
    const { archivoBase64 } = req.body;
    if (!archivoBase64) {
      return res.status(400).json({ error: 'Falta archivoBase64' });
    }

    // El frontend manda el data URI completo (leerArchivoComoBase64 en
    // api/client.js), igual que ya hace la subida de imágenes del catálogo
    // visual (ver routes/catalogo.js) -- acá se le saca la parte
    // "data:...;base64," antes de decodificar.
    const soloBase64 = archivoBase64.includes(',') ? archivoBase64.split(',')[1] : archivoBase64;
    const buffer = Buffer.from(soloBase64, 'base64');
    // XLSX detecta el formato real (CSV o XLSX) por el contenido del buffer,
    // no hace falta mirar la extensión del nombre de archivo.
    const libro = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: null });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El archivo no tiene filas' });
    }

    // Mapea cada columna real del archivo a su nombre normalizado (fecha/nombre/rut/telefono).
    const columnasDetectadas = Object.keys(filas[0]);
    const mapaColumnas = {};
    for (const col of columnasDetectadas) {
      const alias = ALIAS_COLUMNAS[normalizarEncabezado(col)];
      if (alias) mapaColumnas[alias] = col;
    }
    const faltantes = ['fecha', 'nombre', 'telefono'].filter((c) => !mapaColumnas[c]);
    if (faltantes.length > 0) {
      return res.status(400).json({ error: `Faltan columnas obligatorias: ${faltantes.join(', ')}` });
    }

    // Clientes existentes de esta empresa, para matchear por rut/teléfono
    // (prisma ya descifra el rut al leer, ver lib/prisma.js).
    const existentes = await prisma.cliente.findMany({
      where: { empresaId: req.usuario.empresaId },
      select: { id: true, rut: true, telefono: true, fichaJson: true },
    });
    const existentePorRut = new Map(existentes.filter((c) => c.rut).map((c) => [c.rut, c]));
    const existentePorTelefono = new Map(existentes.filter((c) => c.telefono).map((c) => [c.telefono, c]));

    let creados = 0, actualizados = 0;
    const filasConError = [];

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numeroFila = i + 2; // +1 por índice base 0, +1 por la fila de encabezado

      const nombre = fila[mapaColumnas.nombre] ? String(fila[mapaColumnas.nombre]).trim() : null;
      const rut = fila[mapaColumnas.rut] ? normalizarRut(fila[mapaColumnas.rut]) : null;
      const telefono = normalizarTelefono(fila[mapaColumnas.telefono]);
      const fecha = normalizarFecha(fila[mapaColumnas.fecha]);

      if (!nombre) {
        filasConError.push({ fila: numeroFila, motivo: 'Falta el nombre' });
        continue;
      }
      if (!telefono) {
        filasConError.push({ fila: numeroFila, motivo: 'Teléfono inválido (debe ser un móvil chileno de 9 dígitos)' });
        continue;
      }
      if (!fecha) {
        filasConError.push({ fila: numeroFila, motivo: 'Fecha inválida' });
        continue;
      }
      if (fila[mapaColumnas.rut] && !rut) {
        filasConError.push({ fila: numeroFila, motivo: 'RUT con formato inválido' });
        continue;
      }

      const existente = (rut && existentePorRut.get(rut)) || existentePorTelefono.get(telefono);

      if (existente) {
        const fechaActual = existente.fichaJson?.receta?.fecha;
        const esMasReciente = !fechaActual || fecha > fechaActual;
        if (esMasReciente) {
          await prisma.cliente.update({
            where: { id: existente.id },
            data: { fichaJson: { ...existente.fichaJson, receta: { fecha } } },
          });
          actualizados++;
        }
      } else {
        const nuevo = await prisma.cliente.create({
          data: {
            empresaId: req.usuario.empresaId,
            nombre,
            rut: rut || undefined,
            telefono,
            fichaJson: { receta: { fecha } },
            optInCampanas: false,
          },
        });
        if (rut) existentePorRut.set(rut, nuevo);
        existentePorTelefono.set(telefono, nuevo);
        creados++;
      }
    }

    res.json({ creados, actualizados, filasConError, totalFilas: filas.length });
  } catch (error) {
    console.error('Error en POST /empresa/recordatorio-control-anual/importar:', error);
    res.status(500).json({ error: 'Error al importar el archivo' });
  }
});

module.exports = router;
