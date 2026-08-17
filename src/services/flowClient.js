/**
 * src/services/flow  
 * 
 * Cliente para integrar con Flow.cl API v2 (suscripciones + pagos únicos).
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
 * Mapeo de planes Totemsystem a precios Flow (en CLP)
 */
const PLANES = {
  A: { precio: 9900, nombre: 'Plan A - 100 citas', descripcion: '100 citas/mes, excedente $150/cita' },
  B: { precio: 19900, nombre: 'Plan B - 300 citas', descripcion: '300 citas/mes, excedente $90/cita' },
  C: { precio: 39900, nombre: 'Plan C - 700 citas', descripcion: '700 citas/mes, excedente $60/cita' },
};

const HOSTING_ANUAL_CLP = 34000; // 1 UF ≈ $34.000

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

    if (data.code !== 0) {
      throw new Error(`Flow error ${data.code}: ${data.message || 'Sin detalles'}`);
    }

    return data.data || data;
  } catch (err) {
    console.error(`[flowClient] Error en ${endpoint}:`, err.message);
    throw err;
  }
}

/**
 * Realiza una petición POST a Flow (para crear suscripciones/órdenes)
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

    if (data.code !== 0) {
      throw new Error(`Flow error ${data.code}: ${data.message || 'Sin detalles'}`);
    }

    return data.data || data;
  } catch (err) {
    console.error(`[flowClient] Error POST en ${endpoint}:`, err.message);
    throw err;
  }
}

/**
 * Crea una suscripción de plan mensual en Flow.
 * Retorna { subscriptionId, redirectUrl }
 */
async function crearSuscripcionPlan(plan, empresaId, emailEmpresa, telefonoEmpresa) {
  if (!PLANES[plan]) {
    throw new Error(`Plan inválido: ${plan}`);
  }

  const planData = PLANES[plan];
  
  // Flow espera un "order" único por empresa/plan
  const uniqueOrder = `totemsystem-${plan}-${empresaId}-${Date.now()}`;

  const params = {
    commerceOrder: uniqueOrder,
    subject: planData.nombre,
    currency: 'CLP',
    amount: planData.precio,
    email: emailEmpresa,
    phone: telefonoEmpresa,
    urlConfirmation: `${process.env.BACKEND_URL}/suscripcion/flow-webhook-plan`,
    urlReturn: `${obtenerUrlPanelPrincipal()}/suscripcion/resultado?plan=${plan}&empresaId=${empresaId}`,
  };

  const resultado = await requestFlowPost('/payment/create', params);

  // Flow devuelve { token, ... }
  return {
    token: resultado.token,
    url: `https://www.flow.cl/app/web/pay.php?token=${resultado.token}`,
  };
}

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
 * Consulta el estado de una orden/suscripción en Flow
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
 * Verifica firma HMAC de webhook (Flow envia s=hmac en el POST)
 */
function verificarHmacWebhook(params) {
  const sRecibido = params.s;
  delete params.s; // No incluir la firma en el cálculo

  const sCalculado = calcularHmac(params);
  return sRecibido === sCalculado;
}

module.exports = {
  crearSuscripcionPlan,
  crearOrdenCreditos,
  consultarEstado,
  verificarHmacWebhook,
  PLANES,
};