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
const jwt = require('jsonwebtoken');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');
const flowClient = require('../services/flowClient');
const { PLANES: DETALLE_PLANES } = require('../services/contratoHtml'); // fuente única de montoMensual/citasIncluidas/precioCitaExcedente por plan
console.log('flowClient cargado:', Object.keys(flowClient));

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
        pruebahasta: true,
        suscripcion: { select: { plan: true, estado: true, fechaProximoCobro: true } },
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const hoy = new Date();
    const diasParaVencer = empresa.pruebahasta
      ? Math.ceil((empresa.pruebahasta - hoy) / (1000 * 60 * 60 * 24))
      : null;
    const enPruebaVigente = !empresa.suscripcion && empresa.pruebahasta && hoy < empresa.pruebahasta;

    res.json({
      estado: empresa.suscripcion?.estado || (enPruebaVigente ? 'PRUEBA' : null),
      plan: empresa.suscripcion?.plan || null,
      pruebahasta: empresa.pruebahasta,
      vencimientoPago: empresa.suscripcion?.fechaProximoCobro || null,
      diasParaVencer,
      enPrueba: enPruebaVigente,
      vencido: !empresa.suscripcion && empresa.pruebahasta && hoy >= empresa.pruebahasta,
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

    // req.usuario no lo llena ningún middleware acá (esta ruta acepta tanto
    // usuarios autenticados como clientes nuevos sin token todavía) — se
    // verifica el JWT a mano si vino uno.
    let usuarioJwt = null;
    if (token) {
      try {
        usuarioJwt = jwt.verify(token, JWT_SECRET);
      } catch (errJwt) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }
    }

    // Determinar empresaId: del JWT o del body
    let empresaId;
    if (usuarioJwt && usuarioJwt.empresaId) {
      // Usuario autenticado: usar su empresaId del JWT
      empresaId = usuarioJwt.empresaId;
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
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // OPCIÓN A: Flow.cl todavía no está integrado (pipeline de cobro roto,
    // fuera de alcance de esta fase — ver tarea de background aparte). Por
    // ahora dejamos la Suscripcion real en PENDIENTE_PAGO; un admin la pasa a
    // ACTIVA manualmente en POST /admin-vendedores/suscripciones/:empresaId/marcar-activa
    // una vez coordinado el cobro fuera del sistema.
    const planEnum = `PLAN_${plan}`;
    const detallePlan = DETALLE_PLANES[planEnum];

    const fechaProximoCobro = new Date();
    fechaProximoCobro.setMonth(fechaProximoCobro.getMonth() + 1);
    const fechaProximoCobroHosting = new Date();
    fechaProximoCobroHosting.setFullYear(fechaProximoCobroHosting.getFullYear() + 1);

    const suscripcionExistente = await prisma.suscripcion.findUnique({ where: { empresaId } });

    if (suscripcionExistente) {
      // No tocamos estado/fechaActivacion acá — si ya estaba ACTIVA, elegir de
      // nuevo el plan no debe revertir una conversión ya contada en el ranking.
      await prisma.suscripcion.update({
        where: { empresaId },
        data: {
          plan: planEnum,
          montoMensualActual: detallePlan.montoMensual,
          citasIncluidas: detallePlan.citasIncluidas,
          precioCitaExcedente: detallePlan.precioCitaExcedente,
        },
      });
    } else {
      await prisma.suscripcion.create({
        data: {
          empresaId,
          plan: planEnum,
          estado: 'PENDIENTE_PAGO',
          montoMensualActual: detallePlan.montoMensual,
          citasIncluidas: detallePlan.citasIncluidas,
          precioCitaExcedente: detallePlan.precioCitaExcedente,
          fechaProximoCobro,
          fechaProximoCobroHosting,
        },
      });
    }

    console.log(`[elegir-plan] Suscripcion ${planEnum} para empresa ${empresaId} (PENDIENTE_PAGO si es nueva)`);

    res.json({
      exitoso: true,
      plan,
      monto: detallePlan.montoMensual,
      mensaje: 'Plan elegido exitosamente',
      proximoPaso: 'Nos contactaremos en breve para confirmar el pago',
      empresaId,
    });
  } catch (error) {
    console.error('Error en POST /suscripcion/elegir-plan:', error);
    res.status(500).json({ error: 'Error al procesar solicitud' });
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
    const historialSuscripcion = await prisma.historialSuscripcion.findFirst({
      where: { flowSuscripcionId: token },
      include: { empresa: true },
    });

    if (!historialSuscripcion) {
      console.error('[webhook] Suscripción no encontrada para token:', token);
      return res.status(404).send('Suscripción no encontrada');
    }

    const { empresaId, planNuevo } = historialSuscripcion;

    // Transacción: actualizar estado de empresa
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
          pruebahasta: null,
          diasAdvertenciaEnviados: 0,
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
      return res.status(404).send('OK');
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