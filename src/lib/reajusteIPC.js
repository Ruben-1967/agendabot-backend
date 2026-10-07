// src/lib/reajusteIPC.js
//
// Recordatorio del reajuste anual por IPC (cláusula 12 del contrato: se aplica
// en el mes de aniversario, con aviso previo de 30 días al cliente). El sistema
// NO aplica el reajuste ni manda el aviso al cliente -- los planes de Flow
// tienen monto fijo y el IPC lo informa el INE --, solo le avisa al administrador
// con tiempo para hacerlo a mano. Lógica pura (sin base de datos) para poder
// probarla aparte; la consulta vive en chequeoSaludDiario.js.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Se avisa cuando faltan entre 30 y 45 días para el aniversario: 30 es el plazo
// legal del aviso, y los 15 días de margen cubren que el chequeo diario falle
// un par de días o que el administrador esté fuera.
const DIAS_MINIMOS_AVISO = 30;
const DIAS_MARGEN_ANTICIPACION = 15;

function soloFechaUTC(fecha) {
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
}

// Próximo aniversario (mismo día y mes que la activación) que no haya pasado.
// Si el día no existe ese año (29-feb), cae al 28-feb.
function proximoAniversario(fechaActivacion, hoy) {
  const base = new Date(fechaActivacion);
  const mes = base.getUTCMonth();
  const dia = base.getUTCDate();
  const hoyMs = soloFechaUTC(hoy);
  let anio = hoy.getUTCFullYear();
  for (let i = 0; i < 2; i++, anio++) {
    let candidato = Date.UTC(anio, mes, dia);
    if (new Date(candidato).getUTCMonth() !== mes) candidato = Date.UTC(anio, mes, dia - 1);
    // Un contrato no se reajusta en el año en que se activó: el primer
    // aniversario es un año después de la activación.
    if (candidato >= hoyMs && anio > base.getUTCFullYear()) return new Date(candidato);
  }
  return null;
}

/**
 * suscripciones: [{ empresaNombre, fechaActivacion }] ya filtradas a las ACTIVAS
 * y no exentas de plan. Devuelve las que están dentro de la ventana de aviso.
 */
function suscripcionesParaAvisoReajuste(suscripciones, hoy = new Date()) {
  const hoyMs = soloFechaUTC(hoy);
  const resultado = [];
  for (const s of suscripciones) {
    if (!s.fechaActivacion) continue;
    const aniversario = proximoAniversario(s.fechaActivacion, hoy);
    if (!aniversario) continue;
    const dias = Math.round((aniversario.getTime() - hoyMs) / MS_POR_DIA);
    if (dias >= DIAS_MINIMOS_AVISO && dias <= DIAS_MINIMOS_AVISO + DIAS_MARGEN_ANTICIPACION) {
      resultado.push({ empresaNombre: s.empresaNombre, aniversario, dias, fechaLimiteAviso: new Date(aniversario.getTime() - DIAS_MINIMOS_AVISO * MS_POR_DIA) });
    }
  }
  return resultado;
}

module.exports = { proximoAniversario, suscripcionesParaAvisoReajuste, DIAS_MINIMOS_AVISO, DIAS_MARGEN_ANTICIPACION };
