/**
 * src/routes/clientesWeb.js
 *
 * Panel "Clientes Web" de Multidigital (sitio web + correos), solo rolVendedor
 * ADMIN. Montado en /admin-vendedores/clientes-web.
 *
 * Cada ClienteWeb es una ficha con su etapa en el embudo (INTERESADO ->
 * EJEMPLO_ENVIADO -> EN_ESPERA -> ABONO -> ACTIVO -> BAJA) y una cuenta
 * corriente de movimientos: CARGO (lo que debe) y PAGO (lo que pagó). Saldo =
 * cargos - pagos. Los pagos de Flow los agrega solo /web/flow-webhook (ver
 * registrarPagoFlowEnClienteWeb) cuando la ficha está vinculada a una
 * SuscripcionWeb, que se crea desde acá con "generar link".
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRolVendedorAdmin } = require('../middleware/auth');
const { crearLinkSuscripcionWeb, urlSuscripcionWeb } = require('../lib/linkSuscripcionWeb');
const { esIdUsuarioWhatsApp } = require('../services/whatsapp');

const ETAPAS = ['INTERESADO', 'EJEMPLO_ENVIADO', 'EN_ESPERA', 'ABONO', 'ACTIVO', 'BAJA'];
const CONCEPTOS = ['MENSUALIDAD', 'ANUALIDAD', 'HOSTING', 'DOMINIO', 'CAMBIO', 'CORREO_EXTRA', 'OTRO'];
const MEDIOS = ['TRANSFERENCIA', 'FLOW', 'EFECTIVO', 'OTRO'];
const CAMPOS_EDITABLES = ['negocio', 'rubro', 'contactoNombre', 'telefono', 'email', 'comuna', 'dominio',
  'linkMuestra', 'plan', 'condiciones', 'notas', 'preferencia', 'horarioLlamada'];

router.use(requireAuth, requireRolVendedorAdmin);

// Teléfono a solo dígitos con código de país, igual que lo guarda el bot
// ("912345678" -> "56912345678"), para que la misma persona no quede en dos fichas.
function soloDigitos(t) {
  // Id de WhatsApp de quien oculta su número (BSUID, ej. "CO.2549034048909580"): tal cual.
  if (esIdUsuarioWhatsApp(t)) return String(t);
  const d = t ? String(t).replace(/\D/g, '') : '';
  if (!d) return null;
  return /^9\d{8}$/.test(d) ? `56${d}` : d;
}

// Normaliza los campos de texto que vienen del panel ('' -> null).
function datosDesdeBody(body) {
  const datos = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] === undefined) continue;
    const valor = typeof body[campo] === 'string' ? body[campo].trim() : body[campo];
    datos[campo] = valor === '' ? null : valor;
  }
  if (datos.telefono !== undefined) datos.telefono = soloDigitos(datos.telefono);
  if (datos.email) datos.email = datos.email.toLowerCase();
  if (datos.plan !== undefined && datos.plan !== null && !['MENSUAL', 'ANUAL'].includes(datos.plan)) {
    throw Object.assign(new Error('Plan inválido (MENSUAL o ANUAL).'), { status: 400 });
  }
  return datos;
}

// Fechas que acompañan a un cambio de etapa (solo se fijan la primera vez).
function fechasPorEtapa(etapaNueva, actual = {}) {
  const ahora = new Date();
  const extra = {};
  if (etapaNueva === 'EJEMPLO_ENVIADO' && !actual.fechaEjemplo) extra.fechaEjemplo = ahora;
  if (etapaNueva === 'ACTIVO' && !actual.fechaActivacion) extra.fechaActivacion = ahora;
  if (etapaNueva === 'BAJA') extra.fechaBaja = ahora;
  if (etapaNueva !== 'BAJA' && actual.fechaBaja) extra.fechaBaja = null;
  return extra;
}

function resumenCuenta(movimientos) {
  let cargos = 0;
  let pagos = 0;
  for (const m of movimientos) {
    if (m.tipo === 'CARGO') cargos += m.monto;
    else pagos += m.monto;
  }
  return { cargos, pagos, saldo: cargos - pagos };
}

function vistaSuscripcion(sw) {
  if (!sw) return null;
  return {
    id: sw.id,
    estado: sw.estado,
    plan: sw.plan,
    montoConIva: sw.montoConIva,
    link: urlSuscripcionWeb(sw.ref),
    fechaPrimerCobro: sw.fechaPrimerCobro,
    fechaAceptacion: sw.fechaAceptacion,
    tarjetaUltimos4: sw.tarjetaUltimos4,
    fechaUltimoPago: sw.fechaUltimoPago,
    ultimoPagoFallido: sw.pagos?.[0]?.estado === 'FALLIDO',
  };
}

router.get('/', async (req, res) => {
  try {
    const clientes = await prisma.clienteWeb.findMany({
      // Por fecha de creación (no de actualización): la ficha abierta no salta de lugar al editarla.
      orderBy: { creadoEn: 'desc' },
      include: {
        movimientos: { select: { tipo: true, monto: true } },
        suscripcionWeb: { include: { pagos: { orderBy: { fecha: 'desc' }, take: 1 } } },
      },
    });
    res.json({
      etapas: ETAPAS,
      clientes: clientes.map(({ movimientos, suscripcionWeb, ...c }) => ({
        ...c,
        cuenta: resumenCuenta(movimientos),
        suscripcion: vistaSuscripcion(suscripcionWeb),
      })),
    });
  } catch (error) {
    console.error('[clientes-web GET] Error:', error);
    res.status(500).json({ error: 'No se pudo cargar la lista' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await prisma.clienteWeb.findUnique({
      where: { id: req.params.id },
      include: {
        movimientos: { orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }] },
        suscripcionWeb: { include: { pagos: { orderBy: { fecha: 'desc' }, take: 5 } } },
      },
    });
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const { suscripcionWeb, ...resto } = c;
    res.json({ ...resto, cuenta: resumenCuenta(c.movimientos), suscripcion: vistaSuscripcion(suscripcionWeb) });
  } catch (error) {
    console.error('[clientes-web GET :id] Error:', error);
    res.status(500).json({ error: 'No se pudo cargar el cliente' });
  }
});

router.post('/', async (req, res) => {
  try {
    const datos = datosDesdeBody(req.body);
    if (!datos.negocio) return res.status(400).json({ error: 'Falta el nombre del negocio' });
    const etapa = ETAPAS.includes(req.body.etapa) ? req.body.etapa : 'INTERESADO';
    const c = await prisma.clienteWeb.create({
      data: { ...datos, etapa, origen: 'MANUAL', ...fechasPorEtapa(etapa) },
    });
    res.status(201).json(c);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[clientes-web POST] Error:', error);
    res.status(500).json({ error: 'No se pudo crear el cliente' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const actual = await prisma.clienteWeb.findUnique({ where: { id: req.params.id } });
    if (!actual) return res.status(404).json({ error: 'Cliente no encontrado' });
    const datos = datosDesdeBody(req.body);
    if (datos.negocio === null) return res.status(400).json({ error: 'El nombre del negocio no puede quedar vacío' });
    if (req.body.etapa !== undefined) {
      if (!ETAPAS.includes(req.body.etapa)) return res.status(400).json({ error: 'Etapa inválida' });
      datos.etapa = req.body.etapa;
      Object.assign(datos, fechasPorEtapa(req.body.etapa, actual));
    }
    const c = await prisma.clienteWeb.update({ where: { id: actual.id }, data: datos });
    res.json(c);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[clientes-web PATCH] Error:', error);
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const c = await prisma.clienteWeb.findUnique({ where: { id: req.params.id }, include: { suscripcionWeb: true } });
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    // Con cobro automático vivo en Flow, borrar la ficha dejaría pagos sin dueño.
    if (c.suscripcionWeb && c.suscripcionWeb.estado !== 'CANCELADA' && c.suscripcionWeb.estado !== 'PENDIENTE') {
      return res.status(409).json({ error: 'Tiene una suscripción de Flow activa o en curso: cancélala antes de eliminar la ficha.' });
    }
    await prisma.$transaction(async (tx) => {
      // Un link enviado pero sin usar queda anulado: si no, el cliente podría suscribirse
      // después y sus pagos de Flow no tendrían ficha.
      if (c.suscripcionWeb?.estado === 'PENDIENTE') {
        await tx.suscripcionWeb.update({ where: { id: c.suscripcionWeb.id }, data: { estado: 'CANCELADA' } });
      }
      await tx.clienteWeb.delete({ where: { id: c.id } });
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[clientes-web DELETE] Error:', error);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

router.post('/:id/movimientos', async (req, res) => {
  try {
    const { tipo, concepto, nota } = req.body;
    const monto = Math.round(Number(req.body.monto));
    if (!['CARGO', 'PAGO'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido (CARGO o PAGO)' });
    if (!CONCEPTOS.includes(concepto)) return res.status(400).json({ error: 'Concepto inválido' });
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    const medio = tipo === 'PAGO' ? req.body.medio : null;
    if (tipo === 'PAGO' && !MEDIOS.includes(medio)) return res.status(400).json({ error: 'Medio de pago inválido' });
    const fecha = req.body.fecha ? new Date(`${req.body.fecha}T12:00:00-03:00`) : new Date();
    if (Number.isNaN(fecha.getTime())) return res.status(400).json({ error: 'Fecha inválida' });

    const c = await prisma.clienteWeb.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const m = await prisma.movimientoClienteWeb.create({
      data: { clienteWebId: c.id, tipo, concepto, monto, medio, fecha, nota: nota?.trim() || null },
    });
    await prisma.clienteWeb.update({ where: { id: c.id }, data: { actualizadoEn: new Date() } });
    res.status(201).json(m);
  } catch (error) {
    console.error('[clientes-web movimientos POST] Error:', error);
    res.status(500).json({ error: 'No se pudo registrar el movimiento' });
  }
});

router.delete('/:id/movimientos/:movId', async (req, res) => {
  try {
    const m = await prisma.movimientoClienteWeb.findUnique({ where: { id: req.params.movId } });
    if (!m || m.clienteWebId !== req.params.id) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (m.pagoWebId) return res.status(409).json({ error: 'Los pagos de Flow se registran solos y no se pueden borrar.' });
    await prisma.movimientoClienteWeb.delete({ where: { id: m.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('[clientes-web movimientos DELETE] Error:', error);
    res.status(500).json({ error: 'No se pudo eliminar el movimiento' });
  }
});

// Crea el link de suscripción con Flow para esta ficha y la vincula.
router.post('/:id/link-suscripcion', async (req, res) => {
  try {
    const c = await prisma.clienteWeb.findUnique({ where: { id: req.params.id }, include: { suscripcionWeb: true } });
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const plan = String(req.body.plan || c.plan || '').toUpperCase();
    if (!['MENSUAL', 'ANUAL'].includes(plan)) return res.status(400).json({ error: 'Elige el plan: mensual o anual.' });
    const email = (req.body.email || c.email || '').trim();
    if (!email) return res.status(400).json({ error: 'La ficha necesita un correo para el link de Flow.' });

    const resultado = await prisma.$transaction(async (tx) => {
      // Se revisa DENTRO de la transacción: con un doble clic, el segundo pedido ve el
      // link recién creado y no deja un segundo link huérfano que igual funcionaría.
      const actual = await tx.clienteWeb.findUnique({ where: { id: c.id }, include: { suscripcionWeb: true } });
      if (actual.suscripcionWeb && actual.suscripcionWeb.estado !== 'CANCELADA') {
        throw Object.assign(new Error('Ya tiene un link de suscripción vigente.'), { status: 409 });
      }
      const { suscripcionWeb, link } = await crearLinkSuscripcionWeb({
        nombre: c.negocio, email, plan, dominio: c.dominio, pagadoEl: req.body.pagadoEl || undefined,
        // true = cobrar solo el plan (hosting exento o pactado aparte); por defecto plan + hosting del 1er año.
        sinHostingInicial: req.body.sinHostingInicial === true,
      }, tx);
      await tx.clienteWeb.update({ where: { id: c.id }, data: { suscripcionWebId: suscripcionWeb.id, plan, email } });
      return { link, suscripcion: suscripcionWeb };
    });
    res.status(201).json({ link: resultado.link, suscripcion: vistaSuscripcion(resultado.suscripcion) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[clientes-web link-suscripcion] Error:', error);
    res.status(500).json({ error: 'No se pudo crear el link' });
  }
});

/**
 * Llamado desde /web/flow-webhook al confirmarse un cobro de Flow: si la
 * SuscripcionWeb está vinculada a una ficha, deja en su cuenta el cargo del
 * período y el pago (se anulan, el saldo no cambia). Idempotente por pagoWebId.
 * Nunca lanza: un error acá no debe hacer fallar el webhook de Flow.
 */
async function registrarPagoFlowEnClienteWeb({ suscripcionWebId, pagoWebId, tipo, monto, planSuscripcion, fecha }) {
  try {
    const c = await prisma.clienteWeb.findUnique({
      where: { suscripcionWebId },
      select: { id: true, movimientos: { select: { tipo: true, monto: true } } },
    });
    if (!c || !monto) return;
    const ya = await prisma.movimientoClienteWeb.findUnique({ where: { pagoWebId } });
    if (ya) return;
    const concepto = tipo === 'HOSTING' ? 'HOSTING' : planSuscripcion === 'ANUAL' ? 'ANUALIDAD' : 'MENSUALIDAD';
    // Si la ficha ya tiene deuda por al menos este monto (ej. el admin anotó a mano el
    // cargo de este período), el cobro de Flow la paga: se registra solo el PAGO. Si no,
    // se registra el cargo del período y su pago (se anulan, el saldo no cambia).
    const deudaPrevia = resumenCuenta(c.movimientos).saldo >= monto;
    await prisma.$transaction([
      ...(deudaPrevia ? [] : [prisma.movimientoClienteWeb.create({ data: { clienteWebId: c.id, tipo: 'CARGO', concepto, monto, fecha, nota: 'Cobro automático Flow' } })]),
      prisma.movimientoClienteWeb.create({ data: { clienteWebId: c.id, tipo: 'PAGO', concepto, monto, medio: 'FLOW', fecha, nota: 'Pagado con Flow', pagoWebId } }),
      prisma.clienteWeb.update({ where: { id: c.id }, data: { actualizadoEn: new Date() } }),
    ]);
  } catch (error) {
    if (error.code === 'P2002') return; // dos avisos iguales a la vez
    console.error('[clientes-web] No se pudo registrar el pago de Flow en la ficha:', error);
  }
}

module.exports = router;
module.exports.registrarPagoFlowEnClienteWeb = registrarPagoFlowEnClienteWeb;
module.exports._interno = { resumenCuenta, fechasPorEtapa, datosDesdeBody, ETAPAS };
