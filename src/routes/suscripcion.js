/**
 * src/routes/suscripcion.js
 *
 * Endpoints para:
 * - Elegir plan post-prueba (con o sin autenticación)
 * - Crear orden en Flow
 * - Webhook de confirmación
 * - Consultar estado de suscripción
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const flowClient = require('../services/flowClient');

/**
 * GET /suscripcion/estado
 * Consulta el estado actual de la suscripción de una empresa (requiere autenticación)
 */
router.get('/estado', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        estadoSuscripcion: true,
        planActivo: true,
        pruebahasta: true,
        fechaVencimientoPago: true,
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const hoy = new Date();
    const diasParaVencer = empresa.pruebahasta
      ? Math.ceil((empresa.pruebahasta - hoy) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      estado: empresa.estadoSuscripcion,
      plan: empresa.planActivo,
      pruebahasta: empresa.pruebahasta,
      vencimientoPago: empresa.fechaVencimientoPago,
      diasParaVencer,
      enPrueba: empresa.estadoSuscripcion === 'PRUEBA' && hoy < empresa.pruebahasta,
      vencido: empresa.pruebahasta && hoy >= empresa.pruebahasta && !empresa.planActivo,
    });
  } catch (error) {
    console.error('Error en GET /suscripcion/estado:', error);
    res.status(500).json({ error: 'Error al consultar estado' });
  }
});

/**
 * POST /suscripcion/elegir-plan
 * Body: { plan: 'A' | 'B' | 'C', empresaId?: 'xxx' }
 * Funciona CON token (usuario autenticado) o SIN token + empresaId (nuevo cliente)
 * Crea una orden en Flow y devuelve URL de redirección
 */
router.post('/elegir-plan', async (req, res) => {
  try {
    const { plan, empresaId: empresaIdBody } = req.body;
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;

    // Determinar empresaId: del JWT o del body
    let empresaId;
    if (req.usuario && req.usuario.empresaId) {
      // Usuario autenticado: usar su empresaId del JWT
      empresaId = req.usuario.empresaId;
    } else if (empresaIdBody) {
      // Nuevo cliente: pasar empresaId en body
      empresaId = empresaIdBody;
    } else {
      return res.status(400).json({ error: 'Falta empresaId o autenticación' });
    }

    // Validar plan
    if (!['A', 'B', 'C'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    // Validar que la empresa existe
    const empresa = await prisma.empresa.findUnique({
  where: { id: empresaId },
  select: {
    id: true,
    nombre: true,
    estadoSuscripcion: true,
  },
});

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Crear orden en Flow
    const ordenFlow = await flowClient.crearSuscripcionPlan(
      plan,
      empresaId,
      empresa.correoContacto || 'contacto@totemsystem.cl',
      empresa.telefonoContacto || '+56900000000'
    );

    // Guardar la orden pendiente en BD
    await prisma.historialSuscripcion.create({
      data: {
        empresaId,
        planNuevo: plan,
        montoMensual: flowClient.PLANES[plan].precio,
        flowSuscripcionId: ordenFlow.token,
        fechaProximoCobro: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
      },
    });

    res.json({
      plan,
      urlPago: ordenFlow.url,
      monto: flowClient.PLANES[plan].precio,
    });
  } catch (error) {
    console.error('Error en POST /suscripcion/elegir-plan:', error);
    res.status(500).json({ error: 'Error al crear orden de pago' });
  }
});

/**
 * POST /suscripcion/flow-webhook-plan
 * Flow llama acá cuando se confirma el pago de una suscripción
 * NO requiere autenticación (Flow llama directamente)
 */
router.post('/flow-webhook-plan', async (req, res) => {
  try {
    const { token, status } = req.body;

    // Verificar HMAC
    if (!flowClient.verificarHmacWebhook(req.body)) {
      console.warn('[webhook] HMAC inválido, posible falsificación');
      return res.status(403).send('HMAC inválido');
    }

    // status: 1=Iniciado, 2=Pagado, 3=Rechazado, 4=Anulado
    if (status !== '2') {
      console.log(`[webhook] Pago status ${status}, ignorado`);
      return res.status(200).send('OK');
    }

    // Consultar estado en Flow para confirmar
    const estadoFlow = await flowClient.consultarEstado(token);

    // Buscar orden pendiente
    const historialsuscripcion = await prisma.historialSuscripcion.findFirst({
      where: { flowSuscripcionId: token },
      include: { empresa: true },
    });

    if (!historialsuscripcion) {
      console.error('[webhook] Suscripción no encontrada para token:', token);
      return res.status(404).send('Suscripción no encontrada');
    }

    const { empresaId, planNuevo } = historialsuscripcion;

    // Transacción: actualizar estado de empresa + crear historial
    await prisma.$transaction(async (tx) => {
      const fechaVencimiento = new Date();
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1);

      await tx.empresa.update({
        where: { id: empresaId },
        data: {
          estadoSuscripcion: 'ACTIVA',
          planActivo: planNuevo,
          fechaVencimientoPago: fechaVencimiento,
          flowSuscripcionId: token,
          pruebahasta: null, // Termina la prueba
          diasAdvertenciaEnviados: 0, // Reset
        },
      });
    });

    console.log(`[webhook] Suscripción Plan ${planNuevo} activada para empresa ${empresaId}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('[webhook] Error procesando pago:', error);
    res.status(500).send('Error procesando webhook');
  }
});

/**
 * POST /suscripcion/flow-webhook-creditos
 * Flow llama acá cuando se confirma una compra de créditos
 */
router.post('/flow-webhook-creditos', async (req, res) => {
  try {
    const { token, status } = req.body;

    if (!flowClient.verificarHmacWebhook(req.body)) {
      console.warn('[webhook-creditos] HMAC inválido');
      return res.status(403).send('HMAC inválido');
    }

    if (status !== '2') {
      return res.status(200).send('OK');
    }

    const estadoFlow = await flowClient.consultarEstado(token);

    // Buscar orden de créditos
    const orden = await prisma.ordenCompraCreditos.findFirst({
      where: { flowToken: token, estado: 'PENDIENTE' },
    });

    if (!orden) {
      console.warn('[webhook-creditos] Orden no encontrada para token:', token);
      return res.status(404).send('OK'); // Silencioso, Flow puede reintentar
    }

    // Procesar créditos
    await prisma.$transaction(async (tx) => {
      let billetera = await tx.billeteraCreditos.findUnique({
        where: { empresaId: orden.empresaId },
      });

      if (!billetera) {
        billetera = await tx.billeteraCreditos.create({
          data: { empresaId: orden.empresaId, saldoActual: 0 },
        });
      }

      const nuevoSaldo = billetera.saldoActual + orden.cantidadCreditos;

      await tx.billeteraCreditos.update({
        where: { id: billetera.id },
        data: { saldoActual: nuevoSaldo },
      });

      await tx.movimientoCredito.create({
        data: {
          billeteraId: billetera.id,
          tipo: 'COMPRA',
          cantidad: orden.cantidadCreditos,
          saldoResultante: nuevoSaldo,
          montoClp: orden.montoClp,
          nota: `Compra de ${orden.cantidadCreditos} créditos vía Flow.cl`,
        },
      });

      await tx.ordenCompraCreditos.update({
        where: { id: orden.id },
        data: { estado: 'PAGADA', pagadoEn: new Date() },
      });
    });

    console.log(`[webhook-creditos] Créditos acreditados para empresa ${orden.empresaId}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('[webhook-creditos] Error:', error);
    res.status(500).send('Error procesando webhook');
  }
});

module.exports = router;