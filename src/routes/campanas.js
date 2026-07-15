// PATCH para routes/campanas.js
//
// Esto NO es un archivo nuevo — son los cambios a aplicar en tus endpoints existentes de
// estimar-envio y de envío real, para que acepten una lista opcional de clienteIds.
// Si no se envía clienteIds, el comportamiento es idéntico al de hoy (todos los suscritos).

// ============================================================
// 1) POST /campanas/:id/estimar-envio
// ============================================================
//
// ANTES (aprox, según lo descrito en el roadmap):
//   const suscritos = await prisma.cliente.count({ where: { empresaId, suscrito: true } });
//   const costoEstimado = suscritos * TARIFA_MARKETING;
//
// DESPUÉS:

router.post('/:id/estimar-envio', verificarToken, requireRole(['ADMIN', 'RECEPCION']), async (req, res) => {
  try {
    const { id } = req.params;
    const { clienteIds } = req.body; // NUEVO: array opcional de IDs de cliente

    const campana = await prisma.campanaEnvio.findUnique({ where: { id } });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    let audienciaCount;
    if (Array.isArray(clienteIds) && clienteIds.length > 0) {
      // Audiencia segmentada: solo contamos los que realmente existen y siguen suscritos
      audienciaCount = await prisma.cliente.count({
        where: {
          id: { in: clienteIds },
          empresaId: campana.empresaId,
          suscrito: true,
        },
      });
    } else {
      // Comportamiento actual: todos los suscritos de la empresa
      audienciaCount = await prisma.cliente.count({
        where: { empresaId: campana.empresaId, suscrito: true },
      });
    }

    const TARIFA_MARKETING = 78.49; // CLP, confirmada 14 de julio 2026
    const costoEstimadoClp = Math.round(audienciaCount * TARIFA_MARKETING);

    res.json({ audienciaCount, costoEstimadoClp, tarifaUnitaria: TARIFA_MARKETING });
  } catch (error) {
    console.error('Error en estimar-envio:', error);
    res.status(500).json({ error: 'Error al estimar el envío' });
  }
});

// ============================================================
// 2) POST /campanas/:id/enviar  (el endpoint de envío real)
// ============================================================
//
// Mismo patrón: recibe clienteIds opcional. Si viene, el envío (y por lo tanto
// EnvioRealizado.costoEstimadoClp) se calcula y ejecuta solo sobre esa lista.

router.post('/:id/enviar', verificarToken, requireRole(['ADMIN', 'RECEPCION']), async (req, res) => {
  try {
    const { id } = req.params;
    const { clienteIds } = req.body; // NUEVO: array opcional de IDs de cliente

    const campana = await prisma.campanaEnvio.findUnique({ where: { id } });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    const whereDestinatarios = Array.isArray(clienteIds) && clienteIds.length > 0
      ? { id: { in: clienteIds }, empresaId: campana.empresaId, suscrito: true }
      : { empresaId: campana.empresaId, suscrito: true };

    const destinatarios = await prisma.cliente.findMany({ where: whereDestinatarios });

    // ... acá sigue tu lógica actual de armar y disparar los mensajes de WhatsApp
    // a `destinatarios`, exactamente igual que hoy — lo único que cambia es
    // que la lista puede venir acotada en vez de ser siempre "todos".

    const TARIFA_MARKETING = 78.49;
    const costoRealClp = destinatarios.length * TARIFA_MARKETING;

    await prisma.envioRealizado.create({
      data: {
        campanaId: id,
        cantidadEnviados: destinatarios.length,
        costoEstimadoClp: costoRealClp,
        // ...resto de tus campos existentes
      },
    });

    res.json({ enviados: destinatarios.length, costoRealClp });
  } catch (error) {
    console.error('Error en enviar campaña:', error);
    res.status(500).json({ error: 'Error al enviar la campaña' });
  }
});
