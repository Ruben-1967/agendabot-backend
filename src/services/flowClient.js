/**
 * src/services/flowClient.js
 *
 * Cliente para integrar con Flow.cl API v2 — Suscripciones (cobro recurrente
 * automático) + pago único (créditos de campaña).
 * Usa variables de entorno: FLOW_API_KEY, FLOW_API_SECRET
 */

const crypto = require('crypto');
const { obtenerUrlPanelPrincipal } = require('../lib/urlPanel');

const FLOW_BASE_URL = process.env.FLOW_ENDPOINT || 'https://api.flow.cl/api';
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_API_SECRET = process.env.FLOW_API_SECRET;

if (!FLOW_API_KEY || !FLOW_API_SECRET) {
  console.warn('[flowClient] FLOW_API_KEY o FLOW_API_SECRET no configuradas. Flow deshabilitado.');
}

/**
 * Calcula el hash de autenticación para Flow (HMAC-SHA256)
 */
function calcularHmac(params) {
  const keys = Object.keys(params).sort();
  const cadena = keys.map(k => `${k}${params[k]}`).join('');
  return crypto
    .createHmac('sha256', FLOW_API_SECRET)
    .update(cadena)
    .digest('hex');
}

/**
 * Realiza una petición GET a Flow con autenticación
 */
async function requestFlow(endpoint, params = {}) {
  if (!FLOW_API_KEY || !FLOW_API_SECRET) {
    throw new Error('Flow.cl no está configurado (credenciales faltantes)');
  }

  const allParams = {
    apiKey: FLOW_API_KEY,
    ...params,
  };

  const s = calcularHmac(allParams);
  const queryString = new URLSearchParams(allParams);
  const url = `${FLOW_BASE_URL}${endpoint}?${queryString}&s=${s}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`Flow error ${data.code}: ${data.message || 'Sin detalles'}`);
    }

    return data.data || data;
  } catch (err) {
    console.error(`[flowClient] Error en ${endpoint}:`, err.message);
    throw err;
  }
}

/**
 * Realiza una petición POST a Flow (para crear planes/clientes/suscripciones)
 */
async function requestFlowPost(endpoint, params = {}) {
  if (!FLOW_API_KEY || !FLOW_API_SECRET) {
    throw new Error('Flow.cl no está configurado (credenciales faltantes)');
  }

  const body = {
    apiKey: FLOW_API_KEY,
    ...params,
  };

  const s = calcularHmac(body);
  body.s = s;

  try {
    const response = await fetch(`${FLOW_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    const data = await response.json();

    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`Flow error ${data.code}: ${data.message || 'Sin detalles'}`);
    }

    return data.data || data;
  } catch (err) {
    console.error(`[flowClient] Error POST en ${endpoint}:`, err.message);
    throw err;
  }
}

// ------------------------------------------------------------------
// SUSCRIPCIONES (cobro recurrente automático)
// ------------------------------------------------------------------

/**
 * Crea un Plan en Flow (una sola vez por plan — A/B/C/Hosting, no por cliente).
 * interval: 1=diario, 2=semanal, 3=mensual, 4=anual
 */
async function crearPlanFlow({ planId, nombre, montoClp, interval, urlCallback, trialPeriodDays }) {
  const params = {
    planId,
    name: nombre,
    currency: 'CLP',
    amount: montoClp,
    interval,
    urlCallback,
  };
  if (trialPeriodDays !== undefined) {
    params.trial_period_days = trialPeriodDays;
  }
  return requestFlowPost('/plans/create', params);
}

/**
 * Crea un Cliente en Flow para una Empresa. Se llama una sola vez; el
 * customerId resultante se guarda en Suscripcion.flowCustomerId y se reusa.
 */
async function crearClienteFlow({ empresaId, nombreEmpresa, emailEmpresa }) {
  const params = {
    name: nombreEmpresa,
    email: emailEmpresa,
    externalId: empresaId,
  };
  return requestFlowPost('/customer/create', params);
}

/**
 * Inicia el registro de tarjeta de un Cliente Flow. Devuelve { url, token }
 * — el frontend redirige al cliente a esa url para que ingrese su tarjeta.
 */
async function registrarTarjetaFlow({ customerId, empresaId, plan }) {
  const params = {
    customerId,
    // flow-callback-tarjeta es una ruta del BACKEND (src/routes/suscripcion.js),
    // no del panel — obtenerUrlPanelPrincipal() apunta al panel (Vercel), que
    // no tiene esa ruta y redirige a la home. Debe ser BACKEND_URL.
    url_return: `${process.env.BACKEND_URL}/suscripcion/flow-callback-tarjeta?empresaId=${empresaId}&plan=${plan}`,
  };
  const resultado = await requestFlowPost('/customer/register', params);
  // Flow devuelve `url` (la página base) y `token` por separado — igual que
  // en el pago único clásico, hay que pegarlos para tener un link usable.
  return { ...resultado, url: `${resultado.url}?token=${resultado.token}` };
}

/**
 * Consulta si el registro de tarjeta (iniciado con registrarTarjetaFlow)
 * quedó exitoso. NO usar `status` para decidir esto — confirmado contra una
 * respuesta real de sandbox que status:'1' ya viene con la tarjeta
 * registrada (customerId/creditCardType/last4CardDigits poblados). La forma
 * confiable de saber si funcionó es que esos campos de la tarjeta vengan con
 * datos reales (ver flow-callback-tarjeta en suscripcion.js).
 */
async function consultarEstadoRegistroFlow(token) {
  return requestFlow('/customer/getRegisterStatus', { token });
}

/**
 * Cobra un monto arbitrario a la tarjeta YA registrada de un Cliente Flow,
 * sin volver a pedirle los datos (usado para el primer pago combinado:
 * plan mensual + hosting anual). Es asíncrono — la confirmación real llega
 * a `urlConfirmation` (ver flow-webhook-collect en suscripcion.js), acá solo
 * se dispara el cobro.
 */
async function cobrarCollectFlow({ customerId, montoClp, asunto, ordenComercio, urlConfirmation }) {
  const params = {
    customerId,
    amount: montoClp,
    subject: asunto,
    commerceOrder: ordenComercio,
    currency: 'CLP',
    urlConfirmation,
    urlReturn: `${obtenerUrlPanelPrincipal()}/suscripcion/resultado`,
  };
  return requestFlowPost('/customer/collect', params);
}

/**
 * Crea una Suscripción de un Cliente a un Plan. trialPeriodDays retrasa el
 * primer cobro automático de ESTA suscripción — se usa para no duplicar el
 * cobro del primer período, que ya se cobró vía cobrarCollectFlow.
 */
async function crearSuscripcionFlow({ planId, customerId, trialPeriodDays }) {
  const params = { planId, customerId };
  if (trialPeriodDays !== undefined) {
    params.trial_period_days = trialPeriodDays;
  }
  return requestFlowPost('/subscription/create', params);
}

async function cancelarSuscripcionFlow(subscriptionId) {
  return requestFlowPost('/subscription/cancel', { subscriptionId });
}

// ------------------------------------------------------------------
// PAGO ÚNICO (créditos de campaña) — sin cambios, no forma parte de
// suscripciones
// ------------------------------------------------------------------

/**
 * Crea una orden de compra única (créditos de campaña)
 */
async function crearOrdenCreditos(cantidadCreditos, empresaId, emailEmpresa) {
  const montoClp = cantidadCreditos * 149; // precio por crédito

  const uniqueOrder = `creditos-${empresaId}-${Date.now()}`;

  const params = {
    commerceOrder: uniqueOrder,
    subject: `${cantidadCreditos} créditos de campaña Totemsystem`,
    currency: 'CLP',
    amount: montoClp,
    email: emailEmpresa,
    urlConfirmation: `${process.env.BACKEND_URL}/suscripcion/flow-webhook-creditos`,
    urlReturn: `${obtenerUrlPanelPrincipal()}/billetera/resultado`,
  };

  const resultado = await requestFlowPost('/payment/create', params);

  return {
    token: resultado.token,
    url: `https://www.flow.cl/app/web/pay.php?token=${resultado.token}`,
  };
}

/**
 * Consulta el estado de un pago único en Flow (payment/getStatus). Se usa
 * tanto para el webhook de créditos como para confirmar el cobro combinado
 * de customer/collect — Flow reusa este mismo servicio de status para
 * ambos casos.
 */
async function consultarEstado(token) {
  const resultado = await requestFlow('/payment/getStatus', { token });

  // Flow devuelve status: 1=Iniciado, 2=Pagado, 3=Rechazado, 4=Anulado
  return {
    token,
    estado: resultado.status,
    monto: resultado.amount,
    comercioOrden: resultado.commerceOrder,
    fechaPago: resultado.paymentDate,
  };
}

/**
 * Igual que consultarEstado, pero busca por commerceOrder en vez de token —
 * para reconciliar un cobro cuando el webhook de confirmación nunca llegó
 * (ej. Flow intentó notificar justo durante un redeploy) y no quedó
 * guardado el token en ningún lado, solo el commerceOrder que nosotros
 * mismos generamos.
 */
async function consultarEstadoPorCommerceId(commerceOrder) {
  const resultado = await requestFlow('/payment/getStatusByCommerceId', { commerceId: commerceOrder });

  return {
    token: resultado.token,
    estado: resultado.status,
    monto: resultado.amount,
    comercioOrden: resultado.commerceOrder,
    fechaPago: resultado.paymentDate,
  };
}

/**
 * Verifica firma HMAC de webhook (Flow envia s=hmac en el POST)
 */
function verificarHmacWebhook(params) {
  const copia = { ...params };
  delete copia.s; // No incluir la firma en el cálculo
  return params.s === calcularHmac(copia);
}

module.exports = {
  crearPlanFlow,
  crearClienteFlow,
  registrarTarjetaFlow,
  consultarEstadoRegistroFlow,
  cobrarCollectFlow,
  crearSuscripcionFlow,
  cancelarSuscripcionFlow,
  crearOrdenCreditos,
  consultarEstado,
  consultarEstadoPorCommerceId,
  verificarHmacWebhook,
};
