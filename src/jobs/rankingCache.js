// src/jobs/rankingCache.js
//
// Recalcula el ranking del mes en curso cada 5 minutos y lo deja en
// RankingCacheActual. El ranking no necesita tiempo real (definido en el
// brief de Panel de Vendedores) — alcanza con esta revalidación periódica,
// sin websockets. Mismo patrón que enviarPreguntaOptIn.js: node-cron
// autoprogramado dentro del mismo proceso, activado al hacer require() desde
// server.js.

const cron = require('node-cron');
const { recalcularCacheRanking } = require('../services/rankingService');

cron.schedule('*/5 * * * *', async () => {
  try {
    await recalcularCacheRanking();
  } catch (error) {
    console.error('[job] Error recalculando cache de ranking:', error);
  }
});

// Cálculo inicial al arrancar el proceso, para no esperar 5 min con la cache vacía.
recalcularCacheRanking().catch((error) => {
  console.error('[job] Error en cálculo inicial de ranking:', error);
});
