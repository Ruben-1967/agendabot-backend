// src/jobs/cierreRankingMensual.js
//
// El día 1 de cada mes a las 00:10, cierra el ranking del mes recién
// terminado: snapshot inmutable en RankingMensual, con premios asignados solo
// si se alcanzó la meta grupal mínima. No se vuelve a recalcular después,
// aunque una conversión se revierta.

const cron = require('node-cron');
const { cerrarRankingDelMes } = require('../services/rankingService');

cron.schedule('10 0 1 * *', async () => {
  try {
    const mesRecienTerminado = new Date();
    mesRecienTerminado.setMonth(mesRecienTerminado.getMonth() - 1);
    const resultado = await cerrarRankingDelMes(mesRecienTerminado);
    console.log(`[job] Ranking cerrado para ${resultado.mes}/${resultado.anio}: ${resultado.posiciones.length} posiciones, meta grupal ${resultado.metaGrupalAlcanzada ? 'alcanzada' : 'NO alcanzada'}`);
  } catch (error) {
    console.error('[job] Error cerrando ranking mensual:', error);
  }
});
