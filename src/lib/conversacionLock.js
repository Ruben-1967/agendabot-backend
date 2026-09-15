// Mutex en memoria por conversación (empresaId+telefono+canal) -- protege
// contra 2 mensajes del MISMO cliente llegando casi al mismo tiempo (ej.
// escribe 2 veces seguidas antes de que el bot responda a la primera): sin
// esto, ambos webhooks leen el mismo historial "stale" antes de que
// cualquiera escriba su turno, y el que termine último pisa (last-write-
// wins) el turno del otro en Conversacion.mensajes -- ver
// chatbotEngine.js:procesarMensajeEntrante.
//
// Esto es DISTINTO de la idempotencia de webhook (src/lib/idempotenciaWebhook.js,
// que detecta el mismo wamid entregado 2 veces por Meta) -- acá son 2
// mensajes REALES y distintos del mismo cliente, así que ambos deben
// procesarse, solo que uno después del otro, no en paralelo.
//
// Un mutex en memoria alcanza para este proyecto (un solo proceso/dyno en
// Render, sin Redis ni colas todavía) -- si en el futuro corre más de un
// proceso, esto deja de proteger entre procesos y haría falta un lock
// distribuido (ej. advisory lock de Postgres). No se implementa eso ahora
// por sobre-ingeniería: no hay ningún plan de correr más de un proceso.
//
// IMPORTANTE: nunca envolver una llamada de red lenta (como a la API de
// Claude) dentro de una transacción de base de datos para lograr este
// mismo efecto -- mantener una transacción abierta durante una llamada
// externa aumenta el riesgo de contención/deadlocks. Esto es solo una
// cadena de Promises en memoria, sin ninguna transacción involucrada.

const bloqueos = new Map();

/**
 * Ejecuta `fn` en exclusión mutua para la `clave` dada -- si ya hay una
 * ejecución en curso para la misma clave, espera a que termine antes de
 * empezar. Ejecuciones con claves distintas corren en paralelo sin
 * bloquearse entre sí.
 */
async function conLockDeConversacion(clave, fn) {
  const anterior = bloqueos.get(clave) || Promise.resolve();

  let liberar;
  const actual = new Promise((resolve) => {
    liberar = resolve;
  });
  // Guardamos la cadena en una variable para poder compararla por
  // referencia en el finally -- ".then()" siempre devuelve una promesa
  // NUEVA, así que recalcularla ahí (en vez de reusar esta misma
  // instancia) nunca sería === a lo que hay en el Map, y la limpieza de
  // abajo nunca se ejecutaría.
  const cadena = anterior.then(() => actual);
  bloqueos.set(clave, cadena);

  try {
    await anterior;
    return await fn();
  } finally {
    liberar();
    // Solo limpiar si nadie más encadenó un turno nuevo después del
    // nuestro -- si limpiáramos siempre, borraríamos la entrada que un
    // llamador más nuevo ya está esperando.
    if (bloqueos.get(clave) === cadena) {
      bloqueos.delete(clave);
    }
  }
}

module.exports = { conLockDeConversacion };
