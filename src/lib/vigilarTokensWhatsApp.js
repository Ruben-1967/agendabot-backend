/**
 * src/lib/vigilarTokensWhatsApp.js
 *
 * Vigila el token de WhatsApp de cada negocio para que un token vencido o revocado no deje al bot
 * mudo sin que nadie se entere. Caso real (2026-10-30 al 2026-11-02): el token de Ahorróptica
 * venció (era de 60 días, no "Nunca"), Meta rechazó TODOS los envíos con el código 190 y el bot
 * estuvo ~3 días sin responder.
 *
 * Cada vez que corre (ver src/jobs/vigilarTokensWhatsApp.js), por cada negocio real con token:
 *   1. Le pregunta a Meta por su número (GET /{phone_number_id}). Error 190 = token inválido.
 *   2. Si el token funciona, lee su vencimiento (debug_token con el mismo token). Si vence en menos
 *      de DIAS_AVISO_VENCIMIENTO días, avisa antes de que falle.
 * El aviso sale por CORREO (no por WhatsApp: si WhatsApp es lo que falló, un aviso por ahí no llega).
 * Se avisa una sola vez por problema y se repite si sigue sin resolverse (cada 12 h si ya falló,
 * cada 24 h si solo está por vencer). La memoria de avisos es del proceso: tras un reinicio se
 * puede repetir un aviso, nunca se pierde uno.
 */

const prisma = require('./prisma');
const { enviarAlertaInterna } = require('../services/emailAlertaInterna');

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIAS_AVISO_VENCIMIENTO = 7;
const HORAS_ENTRE_AVISOS = { INVALIDO: 12, POR_VENCER: 24 };
const TIMEOUT_MS = 10000;

/**
 * Decide el estado de un token a partir de las respuestas de Meta (funciones puras, sin red).
 * @param {{ok: boolean, json: Object}} numero - respuesta de GET /{phone_number_id}
 * @param {{ok: boolean, json: Object}|null} debug - respuesta de debug_token (null si no se pidió)
 * @returns {{estado: 'OK'|'INVALIDO'|'POR_VENCER'|'DESCONOCIDO', detalle: string, venceEn?: Date}}
 */
function evaluarToken(numero, debug, ahora = new Date()) {
  if (!numero.ok) {
    const err = numero.json?.error || {};
    if (err.code === 190) return { estado: 'INVALIDO', detalle: String(err.message || 'Token inválido').slice(0, 200) };
    // Otros errores (red, permisos puntuales, límite de uso) no significan token vencido.
    return { estado: 'DESCONOCIDO', detalle: `Meta respondió ${err.code || 'error'}: ${String(err.message || '').slice(0, 120)}` };
  }
  const datos = debug?.json?.data;
  if (datos && datos.is_valid === false) return { estado: 'INVALIDO', detalle: 'Meta indica que el token no es válido' };
  if (datos && datos.expires_at) {
    const venceEn = new Date(datos.expires_at * 1000);
    const dias = (venceEn - ahora) / 86400000;
    if (dias <= DIAS_AVISO_VENCIMIENTO) {
      return { estado: 'POR_VENCER', detalle: `Vence el ${venceEn.toISOString().slice(0, 10)} (en ${Math.max(0, Math.ceil(dias))} días)`, venceEn };
    }
  }
  return { estado: 'OK', detalle: '' };
}

/** ¿Corresponde mandar aviso? Solo para problemas, y respetando el intervalo desde el último aviso igual. */
function debeAvisar(previo, actual, ahora = new Date()) {
  if (actual.estado !== 'INVALIDO' && actual.estado !== 'POR_VENCER') return false;
  if (!previo || previo.estado !== actual.estado) return true;
  const horas = (ahora - previo.avisadoEn) / 3600000;
  return horas >= HORAS_ENTRE_AVISOS[actual.estado];
}

async function pedirMeta(url, token) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  } catch (error) {
    return { ok: false, json: { error: { code: 'red', message: error.message } } };
  }
}

const avisosPrevios = new Map(); // empresaId -> { estado, avisadoEn }

async function vigilarTokensWhatsApp({ ahora = new Date(), enviar = enviarAlertaInterna } = {}) {
  const empresas = await prisma.empresa.findMany({
    where: { whatsappToken: { not: null }, whatsappNumeroId: { not: null }, esDemo: false },
    select: { id: true, nombre: true, whatsappToken: true, whatsappNumeroId: true },
  });
  const resumen = { revisadas: empresas.length, ok: 0, invalidos: 0, porVencer: 0, desconocidos: 0, avisos: 0 };

  for (const e of empresas) {
    const numero = await pedirMeta(`${GRAPH}/${encodeURIComponent(e.whatsappNumeroId)}?fields=id`, e.whatsappToken);
    const debug = numero.ok
      ? await pedirMeta(`${GRAPH}/debug_token?input_token=${encodeURIComponent(e.whatsappToken)}`, e.whatsappToken)
      : null;
    const resultado = evaluarToken(numero, debug, ahora);

    if (resultado.estado === 'OK') resumen.ok++;
    else if (resultado.estado === 'INVALIDO') resumen.invalidos++;
    else if (resultado.estado === 'POR_VENCER') resumen.porVencer++;
    else resumen.desconocidos++;

    if (resultado.estado === 'OK') { avisosPrevios.delete(e.id); continue; }
    if (!debeAvisar(avisosPrevios.get(e.id), resultado, ahora)) continue;

    const caido = resultado.estado === 'INVALIDO';
    try {
      await enviar({
        asunto: caido ? `URGENTE: el bot de ${e.nombre} no puede responder (token de WhatsApp inválido)` : `El token de WhatsApp de ${e.nombre} está por vencer`,
        html: `
          <h2>${caido ? 'El bot no puede enviar mensajes' : 'Token de WhatsApp por vencer'}: ${e.nombre}</h2>
          <p>${resultado.detalle}</p>
          <p>${caido
            ? 'Mientras no se renueve, el bot recibe los mensajes pero Meta rechaza TODAS sus respuestas.'
            : 'Si no se renueva antes de esa fecha, el bot dejará de responder.'}</p>
          <p><b>Cómo arreglarlo:</b> en Meta Business (Luxvision Chile) → Usuarios del sistema → <code>whatsapp_agendabot</code> → <b>Generar token</b>
          con caducidad <b>"Nunca"</b> y los permisos whatsapp_business_management y whatsapp_business_messaging. Luego guardarlo en la empresa.
          <b>No uses "Revocar tokens"</b>: revoca todos a la vez.</p>`,
      });
      avisosPrevios.set(e.id, { estado: resultado.estado, avisadoEn: ahora });
      resumen.avisos++;
    } catch (errorAviso) {
      console.error(`[tokens-whatsapp] No se pudo enviar el aviso de ${e.nombre}:`, errorAviso.message);
    }
  }
  if (resumen.invalidos || resumen.porVencer) console.warn('[tokens-whatsapp] Resumen:', JSON.stringify(resumen));
  return resumen;
}

module.exports = { vigilarTokensWhatsApp, evaluarToken, debeAvisar, DIAS_AVISO_VENCIMIENTO };
