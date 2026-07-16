// src/routes/billetera.js
//
// AJUSTAR AL INTEGRAR EL SDK REAL DE FLOW.CL: las llamadas a flowClient están
// comentadas porque esa integración todavía no existe en el backend — ver
// las notas // AJUSTAR más abajo.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const PRECIO_POR_CREDITO_CLP = 149;
const MINIMO_CREDITOS_COMPRA = 50; // evita que la comisión de Flow se coma el margen en compras muy chicas

// ------------------------------------------------------------
// GET /billetera
// Saldo actual + últimos movimientos, para mostrar en el panel
// ------------------------------------------------------------
router.get('/', requireAuth, requireRole('ADMIN', 'RECEPCION'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    let billetera = await prisma.billeteraCreditos.findUnique({
      where: { empresaId },
      include: {
        movimientos: {
          orderBy: { creadoEn: 'desc' },
          take: 20,
        },
      },
    });

    // Si la empresa nunca ha comprado créditos, la billetera todavía no existe -> la creamos en 0
    if (!billetera) {
      billetera = await prisma.billeteraCreditos.create({
        data: { empresaId, saldoActual: 0 },
        include: { movimientos: true },
      });
    }

    res.json({
      saldoActual: billetera.saldoActual,
      movimientos: billetera.movimientos,
    });
  } catch (error) {
    console.error('Error en GET /billetera:', error);
    res.status(500).json({ error: 'Error al obtener la billetera' });
  }
});

// ------------------------------------------------------------
// POST /billetera/comprar
// Body: { cantidadCreditos: number }
// Crea la orden de pago en Flow.cl y devuelve la URL para redirigir al cliente
// ------------------------------------------------------------
router.post('/comprar', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const { cantidadCreditos } = req.body;

    if (!Number.isInteger(cantidadCreditos) || cantidadCreditos < MINIMO_CREDITOS_COMPRA) {
      return res.status(400).json({
        error: `La cantidad mínima de compra es ${MINIMO_CREDITOS_COMPRA} créditos`,
      });
    }

    const montoClp = cantidadCreditos * PRECIO_POR_CREDITO_CLP;

    // AJUSTAR: acá va la llamada real al SDK/API de Flow.cl para crear la orden de pago.
    // La forma general (según la documentación pública de Flow) es algo como:
    //
    //   const ordenFlow = await flowClient.crearOrden({
    //     commerceOrder: `creditos-${empresaId}-${Date.now()}`,
    //     subject: `Compra de ${cantidadCreditos} créditos de campaña`,
    //     amount: montoClp,
    //     urlConfirmation: `${process.env.BACKEND_URL}/billetera/flow-webhook`,
    //     urlReturn: `${process.env.PANEL_FRONTEND_URL}/billetera/resultado`,
    //   });

    const ordenPendiente = await prisma.ordenCompraCreditos.create({
      data: {
        empresaId,
        cantidadCreditos,
        montoClp,
        estado: 'PENDIENTE',
        // flowToken: ordenFlow.token, // reemplazar una vez tengas el SDK real
      },
    });

    res.json({
      ordenId: ordenPendiente.id,
      montoClp,
      cantidadCreditos,
      // urlPago: ordenFlow.url + '?token=' + ordenFlow.token, // reemplazar con la URL real de Flow
      urlPago: 'PENDIENTE_INTEGRACION_FLOW',
    });
  } catch (error) {
    console.error('Error en POST /billetera/comprar:', error);
    res.status(500).json({ error: 'Error al iniciar la compra de créditos' });
  }
});

// ------------------------------------------------------------
// POST /billetera/flow-webhook
// Flow.cl llama a esto cuando el pago se confirma (o falla).
// Acá, y SOLO acá, se acreditan los créditos.
// ------------------------------------------------------------
router.post('/flow-webhook', async (req, res) => {
  try {
    // AJUSTAR: Flow envía un `token` en el body de la notificación
    // (application/x-www-form-urlencoded). Nunca confiar ciegamente en el
    // webhook sin verificar contra la API de Flow primero.
    const { token } = req.body;

    // const estadoFlow = await flowClient.consultarEstado(token); // GET /payment/getStatus?token=...
    // if (estadoFlow.status !== 2) { // 2 = pagado, según los códigos de estado de Flow
    //   return res.status(200).send('Estado no es pago confirmado, ignorado');
    // }

    const orden = await prisma.ordenCompraCreditos.findUnique({
      where: { flowToken: token },
    });

    if (!orden) {
      console.error('Webhook de Flow recibido sin orden correspondiente. Token:', token);
      return res.status(404).send('Orden no encontrada');
    }

    if (orden.estado !== 'PENDIENTE') {
      // Ya fue procesada antes (Flow puede reintentar el webhook) — no duplicar el crédito.
      return res.status(200).send('Orden ya procesada, ignorado');
    }

    // Transacción: acreditar el saldo + registrar el movimiento + marcar la
    // orden como pagada, todo o nada.
    await prisma.$transaction(async (tx) => {
      let billetera = await tx.billeteraCreditos.findUnique({ where: { empresaId: orden.empresaId } });
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
        data: { estado: 'PAGADA' },
      });
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error en /billetera/flow-webhook:', error);
    res.status(500).send('Error procesando el webhook');
  }
});

module.exports = router;