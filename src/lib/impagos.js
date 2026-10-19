/**
 * src/lib/impagos.js
 *
 * Reglas puras (sin base de datos ni envíos) de la política de impago,
 * decidida 2026-10-19:
 *   - Al detectar el primer cobro fallido se le avisa al cliente (aviso 1) y se
 *     fija la fecha de corte 10 días después de ESE aviso.
 *   - 5 días antes del corte, aviso 2 con la fecha exacta.
 *   - En la fecha de corte, el servicio se pausa (estado PAUSADA_POR_IMPAGO):
 *     el bot deja de responder y el panel no deja crear registros nuevos, pero
 *     sigue permitiendo ver y editar lo existente y exportar datos.
 *   - Si el pago se regulariza, todo se limpia y el servicio vuelve solo.
 * Sesgo deliberado: ante cualquier falla de envío, NO se corta (el corte exige
 * que los dos avisos se hayan enviado de verdad). Ver src/jobs/impagos.js.
 */

const MS_DIA = 86400000;
const DIAS_HASTA_CORTE = 10;
const DIAS_AVISO_2_ANTES_DEL_CORTE = 5;

// El job corre una vez al día a la misma hora, pero los plazos se miden desde el
// instante exacto del aviso 1: sin tolerancia, un milisegundo de diferencia
// empuja el aviso 2 o el corte un día completo.
const TOLERANCIA_MS = 6 * 3600000;
// Mínimo de días entre el aviso 2 y el corte, aunque el job haya estado caído.
const DIAS_MINIMOS_AVISO_2_A_CORTE = 3;

const ACCION = { AVISO_1: 'AVISO_1', AVISO_2: 'AVISO_2', CORTE: 'CORTE' };

/**
 * Fecha de corte vigente al enviar el aviso 2: la original, salvo que el job se
 * haya retrasado y quedaran menos de DIAS_MINIMOS_AVISO_2_A_CORTE días -- en ese
 * caso se corre el corte para que el cliente siempre tenga ese margen tras el aviso.
 */
function corteTrasAviso2(corteImpagoEn, ahora = new Date()) {
  const minimo = ahora.getTime() + DIAS_MINIMOS_AVISO_2_A_CORTE * MS_DIA;
  return corteImpagoEn.getTime() >= minimo ? corteImpagoEn : new Date(minimo);
}

/** Fecha de corte que corresponde a un aviso 1 enviado en `momentoAviso`. */
function calcularCorteImpago(momentoAviso) {
  return new Date(momentoAviso.getTime() + DIAS_HASTA_CORTE * MS_DIA);
}

/**
 * Qué toca hacer ahora con una suscripción en impago. Devuelve una de ACCION o
 * null si no toca nada todavía.
 * @param {{impagoDesde: Date|null, corteImpagoEn: Date|null, avisosImpagoEnviados: number}} s
 */
function accionImpago(s, ahora = new Date()) {
  if (!s.impagoDesde) return null;
  if (s.avisosImpagoEnviados < 1) return ACCION.AVISO_1;
  if (!s.corteImpagoEn) return null; // aviso 1 enviado pero sin fecha de corte: dato inconsistente, no se actúa
  const inicioAviso2 = s.corteImpagoEn.getTime() - DIAS_AVISO_2_ANTES_DEL_CORTE * MS_DIA;
  if (s.avisosImpagoEnviados === 1 && ahora.getTime() >= inicioAviso2 - TOLERANCIA_MS) return ACCION.AVISO_2;
  if (s.avisosImpagoEnviados === 2 && ahora.getTime() >= s.corteImpagoEn.getTime() - TOLERANCIA_MS) return ACCION.CORTE;
  return null;
}

module.exports = {
  ACCION,
  DIAS_HASTA_CORTE,
  DIAS_AVISO_2_ANTES_DEL_CORTE,
  calcularCorteImpago,
  corteTrasAviso2,
  accionImpago,
};
