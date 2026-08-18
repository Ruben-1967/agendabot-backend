/**
 * src/routes/suscripcion.js
 *
 * Endpoints para:
 * - Elegir plan post-prueba (con o sin autenticación)
 * - Registrar tarjeta y cobrar el primer pago combinado (plan + hosting) en Flow
 * - Crear las suscripciones recurrentes (mensual del plan + anual de hosting)
 * - Webhooks de confirmación de Flow (cobro combinado, cobros de período, créditos)
 * - Consultar estado de suscripción
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');
const flowClient = require('../services/flowClient');
const { obtenerUrlPanelPrincipal } = require('../lib/urlPanel');
const { obtenerValorUfHoy } = require('../lib/uf');
const { activarSuscripcionPorCobroFlow } = require('../lib/activarSuscripcionPorCobroFlow');
const { PLANES: DETALLE_PLANES } = require('../services/contratoHtml'); // fuente única de montoMensual/citasIncluidas/precioCitaExcedente por plan

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

    // Nivel del aviso de pago pendiente en el panel — oculto las primeras 12h
    // desde que el cliente activó su cuenta (recién está conociendo el
    // sistema), verde el resto de los primeros 2 días, amarillo el día 3,
    // rojo desde el día 4. Solo aplica con la Suscripcion en PENDIENTE_PAGO.
    let avisoPagoNivel = null;
    if (empresa.suscripcion?.estado === 'PENDIENTE_PAGO') {
      const usuarioActual = await prisma.usuario.findUnique({
        where: { id: req.usuario.userId },
        select: { fechaActivacionCuenta: true },
      });
      if (usuarioActual?.fechaActivacionCuenta) {
        const horasDesdeActivacion = (hoy - usuarioActual.fechaActivacionCuenta) / (1000 * 60 * 60);
        if (horasDesdeActivacion >= 72) avisoPagoNivel = 'rojo';
        else if (horasDesdeActivacion >= 48) avisoPagoNivel = 'amarillo';
        else if (horasDesdeActivacion >= 12) avisoPagoNivel = 'verde';
      }
    }

    res.json({
      estado: empresa.suscripcion?.estado || (enPruebaVigente ? 'PRUEBA' : null),
      plan: empresa.suscripcion?.plan || null,
      pruebahasta: empresa.pruebahasta,
      vencimientoPago: empresa.suscripcion?.fechaProximoCobro || null,
      diasParaVencer,
      enPrueba: enPruebaVigente,
      vencido: !empresa.suscripcion && empresa.pruebahasta && hoy >= empresa.pruebahasta,
      avisoPagoNivel,
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
 * Crea (o reusa) el Cliente en Flow y devuelve la URL para que registre su tarjeta.
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
      empresaId = usuarioJwt.empresaId;
    } else if (empresaIdBody) {
      empresaId = empresaIdBody;
    } else {
      return res.status(400).json({ error: 'Falta empresaId o autenticación' });
    }

    if (!['A', 'B', 'C'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        emailContacto: true,
        usuarios: { where: { rol: 'ADMIN' }, take: 1, select: { email: true } },
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const emailEmpresa = empresa.emailContacto || empresa.usuarios[0]?.email;
    if (!emailEmpresa) {
      return res.status(400).json({ error: 'La empresa no tiene un email de contacto configurado, necesario para registrar el pago' });
    }

    const planEnum = `PLAN_${plan}`;
    const detallePlan = DETALLE_PLANES[planEnum];

    // Placeholders — se sobreescriben con las fechas reales de ciclo una vez
    // que el cobro combinado se confirma en /flow-webhook-collect.
    const fechaProximoCobro = new Date();
    fechaProximoCobro.setMonth(fechaProximoCobro.getMonth() + 1);
    const fechaProximoCobroHosting = new Date();
    fechaProximoCobroHosting.setFullYear(fechaProximoCobroHosting.getFullYear() + 1);

    let suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });

    if (suscripcion) {
      // No tocamos estado/fechaActivacion acá — si ya estaba ACTIVA, elegir de
      // nuevo el plan no debe revertir una conversión ya contada en el ranking.
      suscripcion = await prisma.suscripcion.update({
        where: { empresaId },
        data: {
          plan: planEnum,
          montoMensualActual: detallePlan.montoMensual,
          citasIncluidas: detallePlan.citasIncluidas,
          precioCitaExcedente: detallePlan.precioCitaExcedente,
        },
      });
    } else {
      suscripcion = await prisma.suscripcion.create({
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

    // Crear el Cliente en Flow una sola vez; se reusa en cambios de plan.
    let flowCustomerId = suscripcion.flowCustomerId;
    if (!flowCustomerId) {
      const clienteFlow = await flowClient.crearClienteFlow({
        empresaId,
        nombreEmpresa: empresa.nombre,
        emailEmpresa,
      });
      flowCustomerId = clienteFlow.customerId;
      await prisma.suscripcion.update({ where: { empresaId }, data: { flowCustomerId } });
    }

    const registro = await flowClient.registrarTarjetaFlow({ customerId: flowCustomerId, empresaId, plan });

    console.log(`[elegir-plan] Empresa ${empresaId} eligió ${planEnum}, redirigiendo a registro de tarjeta en Flow`);

    res.json({
      exitoso: true,
      plan,
      monto: detallePlan.montoMensual,
      url: registro.url,
      empresaId,
    });
  } catch (error) {
    console.error('Error en POST /suscripcion/elegir-plan:', error);
    res.status(500).json({ error: 'Error al procesar solicitud' });
  }
});

/**
 * GET|POST /suscripcion/flow-callback-tarjeta
 * Flow redirige acá (url_return de /customer/register) después de que el
 * cliente registra su tarjeta — en la práctica lo hace con POST (probablemente
 * por cómo Transbank retorna del flujo OneClick), así que se acepta también.
 * empresaId/plan siempre vienen por query (van codificados en la url_return
 * que armamos nosotros); el token que agrega Flow puede venir en el body si
 * fue POST.
 * Si la tarjeta quedó registrada, dispara el cobro combinado (plan + hosting)
 * vía /customer/collect — ese cobro es asíncrono, la Suscripcion recién pasa
 * a ACTIVA cuando Flow confirma en /flow-webhook-collect.
 */
async function manejarCallbackTarjeta(req, res) {
  const { empresaId, plan } = req.query;
  const token = req.body?.token || req.query.token;
  const urlError = `${obtenerUrlPanelPrincipal()}/suscripcion/resultado?estado=error`;
  const urlProcesando = `${obtenerUrlPanelPrincipal()}/suscripcion/resultado?estado=procesando`;

  try {
    if (!token || !empresaId || !plan) {
      console.error('[flow-callback-tarjeta] Faltan parámetros:', req.query);
      return res.redirect(`${urlError}&motivo=parametros`);
    }

    const registro = await flowClient.consultarEstadoRegistroFlow(token);
    // Confirmado contra una respuesta real de Flow (sandbox): status:'1' viene
    // junto con customerId/creditCardType/last4CardDigits ya poblados — para
    // este endpoint status:'1' es "registrada", no "pendiente" como en
    // /payment/create (de donde había asumido mal el mismo patrón sin
    // confirmarlo). La señal confiable de éxito es que los datos de la
    // tarjeta realmente vengan poblados, no un número de estado adivinado.
    if (!registro.customerId || !registro.creditCardType) {
      console.warn(`[flow-callback-tarjeta] Registro de tarjeta no exitoso (token recibido: ${token}):`, JSON.stringify(registro));
      return res.redirect(`${urlError}&motivo=tarjeta`);
    }

    const planEnum = `PLAN_${plan}`;
    const detallePlan = DETALLE_PLANES[planEnum];
    if (!detallePlan) {
      console.error('[flow-callback-tarjeta] Plan inválido en query:', plan);
      return res.redirect(`${urlError}&motivo=plan`);
    }

    const suscripcion = await prisma.suscripcion.findUnique({ where: { empresaId } });
    if (!suscripcion) {
      console.error('[flow-callback-tarjeta] No hay Suscripcion para empresa:', empresaId);
      return res.redirect(`${urlError}&motivo=suscripcion`);
    }

    const valorUf = await obtenerValorUfHoy();
    const montoCombinado = detallePlan.montoMensual + valorUf;
    // Id corto y opaco — NO se codifica empresaId/valorUf en el texto del
    // commerceOrder porque Flow lo trunca a 45 caracteres (confirmado en
    // sandbox: un uuid ya se corta ahí). Se guarda la relación en la propia
    // Suscripcion, y el webhook de confirmación busca por este valor.
    const ordenComercio = `fc_${crypto.randomBytes(16).toString('hex')}`;
    await prisma.suscripcion.update({
      where: { empresaId },
      data: { ordenComercioCollectPendiente: ordenComercio, valorUfCollectPendiente: valorUf },
    });

    await flowClient.cobrarCollectFlow({
      customerId: registro.customerId,
      montoClp: montoCombinado,
      asunto: `AgendaBot — Primer pago: Plan ${plan} + Hosting anual`,
      ordenComercio,
      urlConfirmation: `${process.env.BACKEND_URL}/suscripcion/flow-webhook-collect`,
    });

    console.log(`[flow-callback-tarjeta] Cobro combinado disparado para empresa ${empresaId} (orden ${ordenComercio})`);
    res.redirect(`${urlProcesando}&empresaId=${empresaId}`);
  } catch (error) {
    console.error('[flow-callback-tarjeta] Error:', error);
    res.redirect(`${urlError}&motivo=servidor`);
  }
}
router.get('/flow-callback-tarjeta', manejarCallbackTarjeta);
router.post('/flow-callback-tarjeta', manejarCallbackTarjeta);

/**
 * POST /suscripcion/flow-webhook-collect
 * urlConfirmation del cobro combinado (/customer/collect). Si Flow confirma
 * que se pagó, acá recién se crean las 2 suscripciones (plan + hosting) con
 * trial_period_days para que Flow no vuelva a cobrar de inmediato, y la
 * Suscripcion pasa a ACTIVA.
 */
router.post('/flow-webhook-collect', async (req, res) => {
  try {
    const { token } = req.body;

    // Confirmado en sandbox: este webhook llega con SOLO {token}, sin firma
    // `s` — no es que Flow no firme nada, es que la verificación real pasa
    // por la línea de abajo: consultarEstado(token) es una llamada NUESTRA,
    // firmada con nuestro secret, hacia el servidor real de Flow. Un token
    // falso simplemente no devolvería un pago real. verificarHmacWebhook no
    // aplica acá (ese chequeo es para webhooks que si vienen firmados).
    const estadoFlow = await flowClient.consultarEstado(token);
    // estado: 1=Iniciado, 2=Pagado, 3=Rechazado, 4=Anulado
    if (String(estadoFlow.estado) !== '2') {
      console.log(`[flow-webhook-collect] Cobro combinado no pagado (estado ${estadoFlow.estado}), orden ${estadoFlow.comercioOrden}`);
      return res.status(200).send('OK');
    }

    const suscripcionPendiente = await prisma.suscripcion.findUnique({
      where: { ordenComercioCollectPendiente: estadoFlow.comercioOrden },
    });
    if (!suscripcionPendiente) {
      console.error('[flow-webhook-collect] No hay Suscripcion pendiente para commerceOrder:', estadoFlow.comercioOrden);
      return res.status(404).send('Suscripcion no encontrada');
    }
    const { empresaId, valorUfCollectPendiente: valorUf } = suscripcionPendiente;

    const resultado = await activarSuscripcionPorCobroFlow({ empresaId, valorUf, token });
    if (!resultado.ok) {
      console.error(`[flow-webhook-collect] No se pudo activar (empresa ${empresaId}):`, resultado.motivo);
      return res.status(resultado.motivo === 'sin_suscripcion' ? 404 : 500).send(resultado.motivo);
    }

    console.log(resultado.yaActiva
      ? `[flow-webhook-collect] Suscripcion de empresa ${empresaId} ya estaba ACTIVA, webhook duplicado ignorado`
      : `[flow-webhook-collect] Suscripcion ACTIVA para empresa ${empresaId}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('[flow-webhook-collect] Error:', error);
    res.status(500).send('Error procesando webhook');
  }
});

/**
 * POST /suscripcion/flow-webhook-plan
 * urlCallback configurado en cada Plan de Flow (ver scripts/crear-planes-flow.js).
 * Flow llama acá en cada cobro automático de período — a partir del segundo
 * ciclo de cada suscripción, ya que el primero lo cubre /flow-webhook-collect.
 *
 * RIESGO CONOCIDO: el formato exacto del payload que Flow POSTea para cobros
 * de suscripción (¿trae subscriptionId directo, o solo un token a resolver
 * vía getStatus, como en pagos únicos?) no está confirmado en la
 * documentación pública — hay que validarlo contra un cobro real en Sandbox
 * y ajustar la extracción de subscriptionId/estado si hace falta.
 * Confirmado en flow-webhook-collect que Flow NO firma estos POST (llegan
 * sin campo `s`) — si este payload también viene solo con un token, hay
 * que resolverlo vía una consulta propia (firmada) a Flow antes de confiar
 * en subscriptionId/status del body directamente, igual que hace
 * flow-webhook-collect con consultarEstado(token).
 */
router.post('/flow-webhook-plan', async (req, res) => {
  try {
    console.log('[flow-webhook-plan] Payload recibido:', JSON.stringify(req.body));

    const subscriptionId = req.body.subscriptionId || req.body.subscription_id;
    // status típico de Flow: 1=Iniciado/Pendiente, 2=Pagado, 3=Rechazado, 4=Anulado
    const exitoso = String(req.body.status) === '2';

    if (!subscriptionId) {
      console.error('[flow-webhook-plan] Payload sin subscriptionId reconocible, revisar formato real de Flow:', req.body);
      return res.status(200).send('OK'); // 200 igual, para que Flow no reintente indefinidamente mientras se investiga
    }

    const suscripcion = await prisma.suscripcion.findFirst({
      where: { OR: [{ tokenFlow: subscriptionId }, { flowSubscriptionIdHosting: subscriptionId }] },
    });

    if (!suscripcion) {
      console.error('[flow-webhook-plan] No se encontró Suscripcion para subscriptionId:', subscriptionId);
      return res.status(404).send('Suscripcion no encontrada');
    }

    const esHosting = suscripcion.flowSubscriptionIdHosting === subscriptionId;
    const tipo = esHosting ? 'HOSTING' : 'MENSUALIDAD';
    const ahora = new Date();

    if (!exitoso) {
      const intentos = suscripcion.intentosFallidosConsecutivos + 1;
      await prisma.$transaction(async (tx) => {
        await tx.suscripcion.update({
          where: { id: suscripcion.id },
          data: {
            intentosFallidosConsecutivos: intentos,
            estado: intentos >= 3 ? 'PAUSADA_POR_IMPAGO' : suscripcion.estado,
          },
        });
        await tx.pago.create({
          data: {
            suscripcionId: suscripcion.id,
            tipo,
            monto: Number(req.body.amount) || suscripcion.montoMensualActual,
            estado: 'FALLIDO',
            flowOrderId: subscriptionId,
          },
        });
      });
      console.warn(`[flow-webhook-plan] Cobro ${tipo} fallido para empresa ${suscripcion.empresaId} (intento ${intentos})`);
      return res.status(200).send('OK');
    }

    const proximaFecha = esHosting ? 'fechaProximoCobroHosting' : 'fechaProximoCobro';
    const nuevaFecha = new Date(suscripcion[proximaFecha]);
    if (esHosting) {
      nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);
    } else {
      nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
    }

    const monto = Number(req.body.amount) || (esHosting ? undefined : suscripcion.montoMensualActual);

    await prisma.$transaction(async (tx) => {
      await tx.suscripcion.update({
        where: { id: suscripcion.id },
        data: {
          estado: 'ACTIVA',
          intentosFallidosConsecutivos: 0,
          fechaUltimoPago: ahora,
          [proximaFecha]: nuevaFecha,
        },
      });
      await tx.pago.create({
        data: {
          suscripcionId: suscripcion.id,
          tipo,
          monto: monto || 0,
          valorUfDelDia: esHosting ? monto : undefined,
          estado: 'EXITOSO',
          flowOrderId: subscriptionId,
        },
      });
    });

    console.log(`[flow-webhook-plan] Cobro ${tipo} confirmado para empresa ${suscripcion.empresaId}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('[flow-webhook-plan] Error procesando pago:', error);
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
