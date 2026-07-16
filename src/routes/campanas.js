// ============================================================
// campanas-endpoints-nuevos.js
// ============================================================
//
// ESTO NO ES UN ARCHIVO PARA CREAR SUELTO. Es el reemplazo consolidado
// de lo que antes estaba repartido en patch-campanas.js y patch-mensaje-del-dia.js.
//
// QUÉ HACER CON ESTO:
//
// 1. Abre tu routes/campanas.js REAL (el que ya existe en producción, con
//    tus rutas actuales de crear campaña, listar, etc.)
//
// 2. Si tu archivo YA TIENE una ruta POST '/:id/estimar-envio' y/o
//    POST '/:id/enviar' (definidas cuando construiste el catálogo rotativo
//    originalmente) -> BORRA esas versiones viejas completas.
//
// 3. Pega los 3 bloques de abajo (borrador-del-dia, estimar-envio, enviar)
//    en el lugar donde estaban esas rutas, DEJANDO tus rutas existentes
//    de arriba y de abajo intactas (crear campaña, listar campañas, etc.)
//
// 4. Asegúrate de que quede UN SOLO "module.exports = router;" al final
//    de todo el archivo — no debe haber dos.
//
// 5. Ajusta lo marcado con // AJUSTAR (import del Prisma client, del
//    middleware de auth, y cómo armas/mandas el mensaje real de WhatsApp).

const TARIFA_MARKETING = 78.49; // costo real interno, no lo que se le cobra al cliente
const LIMITE_MENSAJE_DEL_DIA = 80;

// ============================================================
// PATCH /campanas/:id/borrador-del-dia
// Body: { productosSeleccionados: [...], mensajeDelDia?: string }
// ============================================================
router.patch(
  '/:id/borrador-del-dia',
  verificarToken,
  requireRole(['ADMIN', 'RECEPCION']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { productosSeleccionados, mensajeDelDia } = req.body;

      if (mensajeDelDia && mensajeDelDia.length > LIMITE_MENSAJE_DEL_DIA) {
        return res.status(400).json({
          error: `El mensaje del día no puede superar los ${LIMITE_MENSAJE_DEL_DIA} caracteres`,
          largoActual: mensajeDelDia.length,
        });
      }

      const campanaActualizada = await prisma.campanaEnvio.update({
        where: { id },
        data: {
          // ...lo que ya guardabas de productosSeleccionados
          mensajeDelDia: mensajeDelDia || null,
        },
      });

      res.json(campanaActualizada);
    } catch (error) {
      console.error('Error en /borrador-del-dia:', error);
      res.status(500).json({ error: 'Error al guardar el borrador del día' });
    }
  }
);

// ============================================================
// POST /campanas/:id/estimar-envio
// Body: { clienteIds?: string[] }
// ============================================================
router.post('/:id/estimar-envio', verificarToken, requireRole(['ADMIN', 'RECEPCION']), async (req, res) => {
  try {
    const { id } = req.params;
    const { clienteIds } = req.body; // array opcional de IDs de cliente (segmentación)

    const campana = await prisma.campanaEnvio.findUnique({ where: { id } });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    let audienciaCount;
    if (Array.isArray(clienteIds) && clienteIds.length > 0) {
      audienciaCount = await prisma.cliente.count({
        where: { id: { in: clienteIds }, empresaId: campana.empresaId, suscrito: true },
      });
    } else {
      audienciaCount = await prisma.cliente.count({
        where: { empresaId: campana.empresaId, suscrito: true },
      });
    }

    const costoEstimadoClp = Math.round(audienciaCount * TARIFA_MARKETING);

    res.json({ audienciaCount, costoEstimadoClp, tarifaUnitaria: TARIFA_MARKETING });
  } catch (error) {
    console.error('Error en estimar-envio:', error);
    res.status(500).json({ error: 'Error al estimar el envío' });
  }
});

// ============================================================
// Función auxiliar: arma los componentes del template de WhatsApp,
// incluyendo el mensaje del día como variable {{1}}
// ============================================================
//
// AJUSTAR: el nombre exacto de la variable y el orden de componentes depende
// de cómo se registró el template "Ver menú" en Meta Business Manager.
// Si el template no tiene ninguna variable {{1}} definida en el body,
// hay que agregarla ahí primero y esperar la re-aprobación de Meta.
function construirComponentesTemplate(campana) {
  const textoVariable = campana.mensajeDelDia || '¡Mira el catálogo de hoy!'; // fallback si no escribió nada

  return [
    {
      type: 'body',
      parameters: [{ type: 'text', text: textoVariable }],
    },
    // ...el resto de los componentes que ya arma tu pedidosEngine.js para
    // la lista interactiva de productos (esto no cambia respecto a lo que ya tienes)
  ];
}

// ============================================================
// POST /campanas/:id/enviar
// Body: { clienteIds?: string[] }
// Envío real: valida saldo de créditos, descuenta, arma el mensaje con
// mensajeDelDia, y registra el EnvioRealizado — todo en una transacción.
// ============================================================
router.post('/:id/enviar', verificarToken, requireRole(['ADMIN', 'RECEPCION']), async (req, res) => {
  try {
    const { id } = req.params;
    const { clienteIds } = req.body;

    const campana = await prisma.campanaEnvio.findUnique({ where: { id } });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    const whereDestinatarios = Array.isArray(clienteIds) && clienteIds.length > 0
      ? { id: { in: clienteIds }, empresaId: campana.empresaId, suscrito: true }
      : { empresaId: campana.empresaId, suscrito: true };

    const destinatarios = await prisma.cliente.findMany({ where: whereDestinatarios });

    if (destinatarios.length === 0) {
      return res.status(400).json({ error: 'No hay destinatarios para esta campaña' });
    }

    // --- BLOQUEO POR SALDO INSUFICIENTE ---
    const billetera = await prisma.billeteraCreditos.findUnique({
      where: { empresaId: campana.empresaId },
    });
    const saldoActual = billetera ? billetera.saldoActual : 0;

    if (saldoActual < destinatarios.length) {
      return res.status(402).json({
        error: 'Saldo de créditos insuficiente para esta campaña',
        saldoActual,
        creditosNecesarios: destinatarios.length,
        creditosFaltantes: destinatarios.length - saldoActual,
      });
    }

    // --- ARMAR Y ENVIAR LOS MENSAJES DE WHATSAPP ---
    const componentesTemplate = construirComponentesTemplate(campana);

    // AJUSTAR: reemplaza esto por tu función real de pedidosEngine.js que
    // manda el template de WhatsApp a cada destinatario. Ejemplo de forma:
    //
    // for (const cliente of destinatarios) {
    //   await enviarTemplateWhatsApp({
    //     to: cliente.telefono,
    //     templateName: 'ver_menu_catalogo', // AJUSTAR: nombre real de tu template
    //     components: componentesTemplate,
    //   });
    // }

    const costoRealClp = destinatarios.length * TARIFA_MARKETING;

    // --- DESCUENTO DE CRÉDITOS + REGISTRO, EN UNA SOLA TRANSACCIÓN ---
    const resultado = await prisma.$transaction(async (tx) => {
      const billeteraActual = await tx.billeteraCreditos.findUnique({
        where: { empresaId: campana.empresaId },
      });

      // Revalidamos el saldo DENTRO de la transacción, por si otro envío
      // se coló entre la primera lectura y este punto.
      if (!billeteraActual || billeteraActual.saldoActual < destinatarios.length) {
        throw new Error('SALDO_INSUFICIENTE_EN_TRANSACCION');
      }

      const nuevoSaldo = billeteraActual.saldoActual - destinatarios.length;

      await tx.billeteraCreditos.update({
        where: { id: billeteraActual.id },
        data: { saldoActual: nuevoSaldo },
      });

      await tx.movimientoCredito.create({
        data: {
          billeteraId: billeteraActual.id,
          tipo: 'CONSUMO',
          cantidad: -destinatarios.length,
          saldoResultante: nuevoSaldo,
          nota: `Envío campaña "${campana.nombre}" — ${destinatarios.length} destinatarios`,
        },
      });

      const envio = await tx.envioRealizado.create({
        data: {
          campanaId: id,
          cantidadEnviados: destinatarios.length,
          costoEstimadoClp: costoRealClp,
          // ...resto de tus campos existentes de EnvioRealizado
        },
      });

      return { nuevoSaldo, envio };
    });

    res.json({
      enviados: destinatarios.length,
      costoRealClp,
      saldoRestante: resultado.nuevoSaldo,
    });
  } catch (error) {
    if (error.message === 'SALDO_INSUFICIENTE_EN_TRANSACCION') {
      return res.status(402).json({ error: 'Saldo de créditos insuficiente (verificado al momento del envío)' });
    }
    console.error('Error en enviar campaña:', error);
    res.status(500).json({ error: 'Error al enviar la campaña' });
  }
});

// NOTA: no pongas module.exports acá si tu campanas.js ya tiene uno más abajo
// con tus otras rutas (crear, listar, etc.) — debe quedar UNO SOLO al final
// de todo el archivo, agrupando estas rutas nuevas junto con las existentes.
