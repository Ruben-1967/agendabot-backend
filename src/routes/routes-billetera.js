// routes/billetera.js
//
// AJUSTAR AL INTEGRAR:
// - Ruta del Prisma client y del middleware de auth (mismo patrón que routes-clientes.js)
// - Las credenciales/SDK real de Flow.cl (acá dejo la forma del flujo, no el detalle exacto
//   de su API, porque aún no está integrado en tu backend según el roadmap)
//
// Flujo:
//   1. Cliente ingresa cuántos créditos quiere comprar (número libre, con un mínimo)
//   2. Se calcula el monto en CLP (cantidad × $149)
//   3. Se crea una orden de pago en Flow.cl y se devuelve la URL de pago al panel
//   4. Cuando Flow confirma el pago (webhook), recién ahí se acreditan los créditos
//      -> nunca se acreditan créditos antes de la confirmación real del pago

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma'); // AJUSTAR
const { verificarToken, requireRole } = require('../middleware/auth'); // AJUSTAR

const PRECIO_POR_CREDITO_CLP = 149;
const MINIMO_CREDITOS_COMPRA = 50; // evita que la comisión de Flow se coma el margen en compras muy chicas

// ------------------------------------------------------------
// GET /billetera
// Saldo actual + últimos movimientos, para mostrar en el panel
// ------------------------------------------------------------
router.get('/', verificarToken, requireRole(['ADMIN', 'RECEPCION']), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId; // AJUSTAR

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
router.post('/comprar', verificarToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId; // AJUSTAR
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
    //     email: req.usuario.email,
    //     urlConfirmation: `${process.env.BACKEND_URL}/billetera/flow-webhook`,
    //     urlReturn: `${process.env.PANEL_FRONTEND_URL}/billetera/resultado`,
    //   });
    //
    // Guardamos la orden como "pendiente" para poder conciliarla cuando llegue el webhook.
    const ordenPendiente = await prisma.ordenCompraCreditos.create({
      data: {
        empresaId,
        cantidadCreditos,
        montoClp,
        estado: 'PENDIENTE',
        // flowToken: ordenFlow.token, // una vez tengas el SDK real
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
    // AJUSTAR: Flow envía un `token` en el body; hay que consultar el estado real
    // de la orden contra la API de Flow (nunca confiar ciegamente en el webhook sin verificar).
    const { token } = req.body;

    // const estadoFlow = await flowClient.consultarEstado(token);
    // if (estadoFlow.status !== 'PAGADO') {
    //   return res.status(200).send('Estado no es pago confirmado, ignorado');
    // }

    const orden = await prisma.ordenCompraCreditos.findUnique({
      where: { flowToken: token },
    });

    if (!orden) {
      // No debería pasar si el token se guardó bien al crear la orden — pero si pasa,
      // es mejor loguearlo fuerte que fallar en silencio (es dinero real de por medio).
      console.error('Webhook de Flow recibido sin orden correspondiente. Token:', token);
      return res.status(404).send('Orden no encontrada');
    }

    if (orden.estado !== 'PENDIENTE') {
      // Ya fue procesada antes (Flow puede reintentar el webhook) — no duplicar el crédito.
      return res.status(200).send('Orden ya procesada, ignorado');
    }

    // Transacción: acreditar el saldo + registrar el movimiento + marcar la orden como pagada,
    // todo o nada, para que nunca quede una compra pagada sin créditos (o viceversa).
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
