/**
 * src/routes/suscripcionWeb.js
 *
 * Suscripción de Multidigital "sitio web + correos" con cobro automático en
 * Flow. Clientes SIN cuenta en el panel (no son Empresa): cada uno recibe un
 * link único /web/suscribir/:ref (se crea con scripts/crear-link-suscripcion-web.js).
 *
 * Flujo:
 *   1. GET  /web/suscribir/:ref  -> resumen + datos + casilla de aceptación.
 *   2. POST /web/suscribir/:ref  -> registra la aceptación (Ley 19.799) y
 *      redirige a Flow para registrar la tarjeta.
 *   3. GET|POST /web/flow-callback-tarjeta?ref=  -> Flow vuelve acá; se crean
 *      2 suscripciones: el plan (mensual/anual, con trial hasta
 *      fechaPrimerCobro si el primer período ya se pagó por fuera) y el hosting
 *      anual (1 UF + IVA) que parte en el primer aniversario.
 *   4. POST /web/flow-webhook  -> urlCallback de los 3 planes web de Flow
 *      (scripts/crear-planes-flow-web.js); registra cada cobro en PagoWeb.
 *
 * Totalmente separado de /suscripcion (TotemSystem): otras tablas, otros
 * planes de Flow y otro webhook. Estado de todas: scripts/listar-suscripciones-web.js.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const flowClient = require('../services/flowClient');
const { normalizarRut } = require('../lib/rut');
const { renderSuscribir, renderResultado } = require('../services/suscripcionWebHtml');

// Va guardada en cada aceptación: si el contrato cambia, se sube la versión
// (y el comentario de cabecera de contrato-sitio-web.html en norman-landing).
const VERSION_CONTRATO = 'web-correos-v5';

const DIA_MS = 24 * 60 * 60 * 1000;

function planIdFlow(plan) {
  return plan === 'ANUAL' ? process.env.FLOW_PLAN_ID_WEB_ANUAL : process.env.FLOW_PLAN_ID_WEB_MENSUAL;
}

// Dígito verificador real (módulo 11): acá el RUT queda en un registro legal
// de aceptación, así que se rechaza uno mal tipeado en vez de guardarlo.
function esRutConDvValido(rutNormalizado) {
  const m = /^(\d{7,8})-([\dK])$/.exec(rutNormalizado);
  if (!m) return false;
  let suma = 0;
  let factor = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    suma += Number(m[1][i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === m[2];
}

// Medianoche UTC del día calendario de Chile en que cae `fecha`.
function diaChile(fecha) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  const v = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(v('year'), v('month') - 1, v('day'));
}

// Días de calendario en Chile entre hoy y `fecha` (no milisegundos: con ceil
// sobre ms, registrar la tarjeta en la mañana corría el cobro un día).
function diasHasta(fecha, ahora) {
  return Math.max(0, Math.round((diaChile(fecha) - diaChile(ahora)) / DIA_MS));
}

// Suma años de calendario (29-feb + 1 año -> 28-feb, no 1-mar).
function sumarAnios(fecha, anios) {
  const r = new Date(fecha);
  const dia = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCFullYear(r.getUTCFullYear() + anios);
  const ultimo = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(dia, ultimo));
  return r;
}

// requestFlow/requestFlowPost lanzan "Flow error <code>: ..." cuando Flow
// RESPONDE rechazando la operación (no se creó nada). Cualquier otro error
// (timeout, red, BD) deja la duda de si Flow alcanzó a crear la suscripción.
function esRechazoExplicitoDeFlow(error) {
  return /^Flow error /.test(error?.message || '');
}

function validarDatos(body) {
  const datos = {
    razonSocial: String(body.razonSocial || '').trim(),
    rut: normalizarRut(body.rut || ''),
    domicilio: String(body.domicilio || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    nombreQuienAcepta: String(body.nombreQuienAcepta || '').trim(),
  };
  if (body.acepto !== 'si') return { datos, error: 'Para continuar debes marcar la casilla de aceptación del contrato.' };
  if (!datos.razonSocial || !datos.domicilio || !datos.nombreQuienAcepta) return { datos, error: 'Completa todos los campos.' };
  if (!esRutConDvValido(datos.rut)) return { datos, error: 'El RUT no es válido. Revísalo (ej.: 12.345.678-9).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) return { datos, error: 'El correo no es válido.' };
  return { datos, error: null };
}

// Lo que se muestra según el estado, para cualquier estado que ya no admite el formulario.
function resultadoPorEstado(sw) {
  if (sw.estado === 'ACTIVA') return 'exito';
  if (sw.estado === 'CANCELADA') return 'cancelada';
  if (sw.estado === 'ACTIVANDO') return 'procesando';
  return null;
}

router.get('/suscribir/:ref', async (req, res) => {
  try {
    const sw = await prisma.suscripcionWeb.findUnique({ where: { ref: req.params.ref } });
    if (!sw) return res.status(404).send(renderResultado('no-encontrada'));
    const resultado = resultadoPorEstado(sw);
    if (resultado) return res.send(renderResultado(resultado, sw));
    res.send(renderSuscribir(sw, {
      valores: {
        razonSocial: sw.razonSocial, rut: sw.rut, domicilio: sw.domicilio,
        email: sw.emailAceptacion, nombreQuienAcepta: sw.nombreQuienAcepta,
      },
    }));
  } catch (error) {
    console.error('[web/suscribir GET] Error:', error);
    res.status(500).send(renderResultado('error'));
  }
});

router.post('/suscribir/:ref', async (req, res) => {
  let sw;
  try {
    sw = await prisma.suscripcionWeb.findUnique({ where: { ref: req.params.ref } });
    if (!sw) return res.status(404).send(renderResultado('no-encontrada'));
    const resultado = resultadoPorEstado(sw);
    if (resultado) return res.send(renderResultado(resultado, sw));

    const { datos, error } = validarDatos(req.body);
    if (error) return res.status(400).send(renderSuscribir(sw, { error, valores: req.body }));

    // Registro legal de la aceptación (clickwrap). Si vuelve a aceptar (ej. no
    // terminó de registrar la tarjeta la primera vez), queda la última. Solo
    // desde PENDIENTE/ACEPTADA: nunca pisa una que ya se está activando.
    const aceptada = await prisma.suscripcionWeb.updateMany({
      where: { id: sw.id, estado: { in: ['PENDIENTE', 'ACEPTADA'] } },
      data: {
        estado: 'ACEPTADA',
        razonSocial: datos.razonSocial,
        rut: datos.rut,
        domicilio: datos.domicilio,
        emailAceptacion: datos.email,
        nombreQuienAcepta: datos.nombreQuienAcepta,
        versionContrato: VERSION_CONTRATO,
        fechaAceptacion: new Date(),
        ipAceptacion: req.ip,
        userAgentAceptacion: req.headers['user-agent'] || null,
      },
    });
    sw = await prisma.suscripcionWeb.findUnique({ where: { id: sw.id } });
    if (aceptada.count === 0) return res.send(renderResultado(resultadoPorEstado(sw) || 'procesando', sw));
    console.log(`[web/suscribir] Contrato ${VERSION_CONTRATO} aceptado: ${sw.id} (${datos.razonSocial}, ${datos.rut})`);

    let customerId = sw.flowCustomerId;
    if (!customerId) {
      const cliente = await flowClient.crearClienteFlowExterno({
        externalId: `web_${sw.id}`,
        nombre: datos.razonSocial,
        email: datos.email,
      });
      customerId = cliente.customerId;
      await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { flowCustomerId: customerId } });
    }

    const registro = await flowClient.registrarTarjetaFlowConRetorno({
      customerId,
      // `ref` y no `token`: Flow agrega su propio `token` a esta url.
      urlReturn: `${process.env.BACKEND_URL}/web/flow-callback-tarjeta?ref=${encodeURIComponent(sw.ref)}`,
    });
    res.redirect(303, registro.url);
  } catch (error) {
    console.error('[web/suscribir POST] Error:', error);
    res.status(500).send(renderResultado('error', sw));
  }
});

async function manejarCallbackTarjeta(req, res) {
  const ref = req.query.ref;
  const token = req.body?.token || req.query.token;
  let sw;
  try {
    sw = ref ? await prisma.suscripcionWeb.findUnique({ where: { ref } }) : null;
    if (!sw) return res.status(404).send(renderResultado('no-encontrada'));
    const resultado = resultadoPorEstado(sw);
    if (resultado) return res.send(renderResultado(resultado, sw));
    if (!token) return res.status(400).send(renderResultado('error', sw));

    const registro = await flowClient.consultarEstadoRegistroFlow(token);
    // Igual que en /suscripcion/flow-callback-tarjeta: la señal confiable es
    // que vengan los datos de la tarjeta, no el número de `status`.
    if (!registro.customerId || !registro.creditCardType || registro.customerId !== sw.flowCustomerId) {
      console.warn(`[web/flow-callback-tarjeta] Registro no exitoso para ${sw.id}:`, JSON.stringify(registro));
      return res.send(renderResultado('error', sw));
    }

    const planId = planIdFlow(sw.plan);
    const planIdHosting = process.env.FLOW_PLAN_ID_WEB_HOSTING;
    if (!planId || !planIdHosting) throw new Error('Faltan FLOW_PLAN_ID_WEB_MENSUAL/ANUAL/HOSTING en el entorno');

    // Flow puede volver con GET y POST casi a la vez: solo uno crea las
    // suscripciones (si no, quedarían 2 cobros por período).
    const tomado = await prisma.suscripcionWeb.updateMany({
      where: { id: sw.id, estado: 'ACEPTADA', flowSubscriptionId: null },
      data: {
        estado: 'ACTIVANDO',
        tarjetaTipo: registro.creditCardType,
        tarjetaUltimos4: registro.last4CardDigits || null,
      },
    });
    if (tomado.count === 0) {
      const actual = await prisma.suscripcionWeb.findUnique({ where: { id: sw.id } });
      return res.send(renderResultado(resultadoPorEstado(actual) || 'procesando', actual));
    }

    const ahora = new Date();
    const fechaInicio = sw.fechaInicioContrato || ahora;

    // 1) Suscripción del plan.
    let susPlan;
    try {
      const trialPlan = sw.fechaPrimerCobro ? diasHasta(sw.fechaPrimerCobro, ahora) : 0;
      susPlan = await flowClient.crearSuscripcionFlow({
        planId,
        customerId: sw.flowCustomerId,
        trialPeriodDays: trialPlan > 0 ? trialPlan : undefined,
      });
    } catch (errorPlan) {
      if (esRechazoExplicitoDeFlow(errorPlan)) {
        // Flow no creó nada: se puede reintentar desde el mismo link.
        await prisma.suscripcionWeb.update({ where: { id: sw.id }, data: { estado: 'ACEPTADA' } });
        throw errorPlan;
      }
      // Timeout/red: Flow pudo haberla creado igual. Queda en ACTIVANDO (no
      // se ofrece reintentar, sería un 2.º cobro por período) para revisar a mano.
      console.error(`[web/flow-callback-tarjeta] REVISAR A MANO ${sw.id}: no se sabe si Flow creó la suscripción del plan:`, errorPlan);
      return res.send(renderResultado('procesando', sw));
    }

    try {
      await prisma.suscripcionWeb.update({
        where: { id: sw.id },
        data: { flowSubscriptionId: susPlan.subscriptionId, fechaInicioContrato: fechaInicio },
      });

      // 2) Hosting anual: primer cobro en el aniversario.
      const susHosting = await flowClient.crearSuscripcionFlow({
        planId: planIdHosting,
        customerId: sw.flowCustomerId,
        trialPeriodDays: Math.max(1, diasHasta(sumarAnios(fechaInicio, 1), ahora)),
      });
      sw = await prisma.suscripcionWeb.update({
        where: { id: sw.id },
        data: { flowSubscriptionIdHosting: susHosting.subscriptionId, estado: 'ACTIVA' },
      });
    } catch (errorDespues) {
      // El plan ya existe en Flow: nunca volver a ACEPTADA (un reintento
      // crearía un 2.º plan). Queda ACTIVANDO para completarlo a mano.
      console.error(`[web/flow-callback-tarjeta] REVISAR A MANO ${sw.id}: plan creado en Flow (${susPlan.subscriptionId}) pero falló lo siguiente:`, errorDespues);
      return res.send(renderResultado('procesando', sw));
    }

    console.log(`[web/flow-callback-tarjeta] Suscripción web ACTIVA: ${sw.id} (${sw.razonSocial}, ${sw.plan})`);
    res.send(renderResultado('exito', sw));
  } catch (error) {
    console.error('[web/flow-callback-tarjeta] Error:', error);
    res.status(500).send(renderResultado('error', sw));
  }
}
router.get('/flow-callback-tarjeta', manejarCallbackTarjeta);
router.post('/flow-callback-tarjeta', manejarCallbackTarjeta);

// Mismo formato que en /suscripcion/flow-webhook-plan (confirmado en sandbox):
// commerceOrder = "sus_<id>_<invoiceId>_<fecha>".
const REGEX_SUBSCRIPTION_ID = /^(sus_[^_]+)_(\d+)_/;

router.post('/flow-webhook', async (req, res) => {
  try {
    const token = req.body.token;
    if (!token) {
      console.error('[web/flow-webhook] Payload sin token:', JSON.stringify(req.body));
      return res.status(200).send('OK');
    }

    // Llamada NUESTRA y firmada hacia Flow: nunca se confía en el body.
    const estadoFlow = await flowClient.consultarEstado(token);
    // 1=Iniciado (aún sin resultado): no se registra nada todavía.
    if (String(estadoFlow.estado) === '1') return res.status(200).send('OK');

    const match = REGEX_SUBSCRIPTION_ID.exec(estadoFlow.comercioOrden || '');
    if (!match) {
      console.error('[web/flow-webhook] commerceOrder sin subscriptionId:', estadoFlow.comercioOrden);
      return res.status(200).send('OK');
    }
    const subscriptionId = match[1];

    const sw = await prisma.suscripcionWeb.findFirst({
      where: { OR: [{ flowSubscriptionId: subscriptionId }, { flowSubscriptionIdHosting: subscriptionId }] },
    });
    if (!sw) {
      // 404 y no 200: sin trial, Flow cobra dentro del mismo subscription/create
      // y su aviso puede llegar antes de que se guarde el subscriptionId; con
      // un no-2xx Flow reintenta y el pago no se pierde.
      console.error('[web/flow-webhook] Sin SuscripcionWeb (todavía) para', subscriptionId);
      return res.status(404).send('Suscripcion no encontrada');
    }

    const exitoso = String(estadoFlow.estado) === '2';
    const tipo = sw.flowSubscriptionIdHosting === subscriptionId ? 'HOSTING' : 'PLAN';
    const fechaPago = estadoFlow.fechaPago ? new Date(estadoFlow.fechaPago) : new Date();

    const previo = await prisma.pagoWeb.findUnique({ where: { flowToken: token } });
    if (previo && (previo.estado === 'EXITOSO' || !exitoso)) return res.status(200).send('OK'); // aviso repetido

    await prisma.$transaction(async (tx) => {
      if (previo) {
        // Mismo token avisado antes como fallido y ahora pagado.
        await tx.pagoWeb.update({ where: { id: previo.id }, data: { estado: 'EXITOSO', monto: Number(estadoFlow.monto) || previo.monto } });
      } else {
        await tx.pagoWeb.create({
          data: {
            suscripcionWebId: sw.id,
            tipo,
            monto: Number(estadoFlow.monto) || 0,
            estado: exitoso ? 'EXITOSO' : 'FALLIDO',
            flowToken: token,
          },
        });
      }
      if (exitoso) {
        await tx.suscripcionWeb.update({ where: { id: sw.id }, data: { fechaUltimoPago: isNaN(fechaPago) ? new Date() : fechaPago } });
      }
    });

    const log = exitoso ? console.log : console.warn;
    log(`[web/flow-webhook] Cobro ${tipo} ${exitoso ? 'EXITOSO' : 'FALLIDO'} para ${sw.razonSocial || sw.nombreCliente} (${sw.id}), $${estadoFlow.monto}`);
    res.status(200).send('OK');
  } catch (error) {
    if (error.code === 'P2002') return res.status(200).send('OK'); // dos avisos iguales a la vez
    console.error('[web/flow-webhook] Error:', error);
    res.status(500).send('Error procesando webhook');
  }
});

module.exports = router;
module.exports._interno = { esRutConDvValido, sumarAnios, diasHasta, validarDatos, esRechazoExplicitoDeFlow, VERSION_CONTRATO };
