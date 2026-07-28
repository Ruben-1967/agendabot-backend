const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { TARIFA_CAMPANA_CATALOGO_CLP } = require('../lib/costosWhatsapp');
const { resolverDestinatariosFinales, obtenerModoOperacion } = require('../lib/segmentacionClientes');

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

// Límite de mensajeDelDia según el modo — en catálogo es un complemento del
// catálogo enviado ("¡Hoy tenemos algo especial!"), en agendamiento ES el
// mensaje completo de la promoción/aviso (no hay catálogo detrás).
const LIMITE_MENSAJE_CATALOGO = 80;
const LIMITE_MENSAJE_AGENDAMIENTO = 400;

// Los negocios de AGENDAMIENTO (reactivos) siempre usan esta misma plantilla
// genérica de Meta — el contenido no depende de nada específico del negocio
// (solo nombre/empresa/mensaje), así que no tiene sentido que el usuario la
// escriba a mano y arriesgue un typo. Se fuerza en el backend (crear, editar
// y enviar), no solo se oculta en el frontend — así ninguna campaña
// reactiva, ni siquiera una ya creada con un valor viejo/equivocado, puede
// terminar apuntando a otra cosa.
const PLANTILLA_REACTIVO_FIJA = 'campana_negocio_reactivo';

function inicioDeHoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function finDeHoy() {
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  return hoy;
}

// GET /campanas — lista de campañas de la empresa, con el envío de HOY si ya existe
router.get('/', async (req, res) => {
  try {
    const modoOperacion = await obtenerModoOperacion(req.usuario.empresaId);
    const esCatalogo = modoOperacion === 'CATALOGO_ROTATIVO';

    const campanas = await prisma.campanaEnvio.findMany({
      where: { empresaId: req.usuario.empresaId },
      include: {
        enviosRealizados: {
          where: { fechaProgramada: { gte: inicioDeHoy(), lte: finDeHoy() } },
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });

    res.json({
      campanas: campanas.map((c) => ({
        ...c,
        // En reactivos, siempre se muestra/usa la plantilla fija — corrige
        // en la lectura cualquier valor viejo que haya quedado guardado.
        plantillaWhatsapp: esCatalogo ? c.plantillaWhatsapp : PLANTILLA_REACTIVO_FIJA,
        envioDeHoy: c.enviosRealizados[0] || null,
        enviosRealizados: undefined,
      })),
    });
  } catch (error) {
    console.error('Error listando campañas:', error);
    res.status(500).json({ error: 'Error al listar campañas' });
  }
});

// GET /campanas/config — modo de operación de la empresa, para que el panel
// sepa qué formulario de segmentación/envío mostrar (productos vs.
// categorías de producto). Las categorías sugeridas ya las entrega
// /clientes/config — no se duplican acá.
router.get('/config', async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      include: { rubroTemplate: true },
    });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    res.json({ modoOperacion: empresa.rubroTemplate.modoOperacion });
  } catch (error) {
    console.error('Error obteniendo config de campañas:', error);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// POST /campanas — crear una campaña nueva
router.post('/', async (req, res) => {
  try {
    const {
      nombre, diasSemana, hora, plantillaWhatsapp,
      segmentada, segmentoDias, segmentoMontoMinimoClp,
      segmentoProductoIds, segmentoCategoriasProducto,
    } = req.body;

    const modoOperacion = await obtenerModoOperacion(req.usuario.empresaId);
    const esCatalogo = modoOperacion === 'CATALOGO_ROTATIVO';

    // En catálogo rotativo, cada negocio puede tener su propia plantilla
    // ("Ver el menú de hoy", etc.) — sigue siendo obligatorio escribirla. En
    // agendamiento, la plantilla es siempre la misma y nunca se pide.
    if (!nombre || !Array.isArray(diasSemana) || !hora || (esCatalogo && !plantillaWhatsapp)) {
      return res.status(400).json({ error: 'Faltan campos: nombre, diasSemana, hora' + (esCatalogo ? ', plantillaWhatsapp' : '') });
    }

    const campana = await prisma.campanaEnvio.create({
      data: {
        empresaId: req.usuario.empresaId,
        nombre,
        diasSemana: diasSemana.map(Number),
        hora,
        plantillaWhatsapp: esCatalogo ? plantillaWhatsapp : PLANTILLA_REACTIVO_FIJA,
        segmentada: Boolean(segmentada),
        segmentoDias: segmentada ? (Number(segmentoDias) || 30) : null,
        segmentoMontoMinimoClp: segmentada && segmentoMontoMinimoClp ? Number(segmentoMontoMinimoClp) : null,
        segmentoProductoIds: segmentada && Array.isArray(segmentoProductoIds) ? segmentoProductoIds : [],
        segmentoCategoriasProducto: segmentada && Array.isArray(segmentoCategoriasProducto) ? segmentoCategoriasProducto : [],
      },
    });

    res.status(201).json({ campana });
  } catch (error) {
    console.error('Error creando campaña:', error);
    res.status(500).json({ error: 'Error al crear campaña' });
  }
});

// PATCH /campanas/:id — editar configuración
router.patch('/:id', async (req, res) => {
  try {
    const campana = await prisma.campanaEnvio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    const {
      nombre, diasSemana, hora, plantillaWhatsapp, activa,
      segmentada, segmentoDias, segmentoMontoMinimoClp,
      segmentoProductoIds, segmentoCategoriasProducto,
    } = req.body;

    const modoOperacion = await obtenerModoOperacion(req.usuario.empresaId);
    const esCatalogo = modoOperacion === 'CATALOGO_ROTATIVO';

    const actualizada = await prisma.campanaEnvio.update({
      where: { id: campana.id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(diasSemana !== undefined && { diasSemana: diasSemana.map(Number) }),
        ...(hora !== undefined && { hora }),
        // En reactivos, la plantilla es siempre PLANTILLA_REACTIVO_FIJA —
        // se ignora cualquier valor que venga del frontend, aunque exista.
        ...(esCatalogo && plantillaWhatsapp !== undefined && { plantillaWhatsapp }),
        ...(!esCatalogo && { plantillaWhatsapp: PLANTILLA_REACTIVO_FIJA }),
        ...(activa !== undefined && { activa: Boolean(activa) }),
        ...(segmentada !== undefined && { segmentada: Boolean(segmentada) }),
        ...(segmentoDias !== undefined && { segmentoDias: segmentoDias ? Number(segmentoDias) : null }),
        ...(segmentoMontoMinimoClp !== undefined && {
          segmentoMontoMinimoClp: segmentoMontoMinimoClp ? Number(segmentoMontoMinimoClp) : null,
        }),
        ...(segmentoProductoIds !== undefined && {
          segmentoProductoIds: Array.isArray(segmentoProductoIds) ? segmentoProductoIds : [],
        }),
        ...(segmentoCategoriasProducto !== undefined && {
          segmentoCategoriasProducto: Array.isArray(segmentoCategoriasProducto) ? segmentoCategoriasProducto : [],
        }),
      },
    });

    res.json({ campana: actualizada });
  } catch (error) {
    console.error('Error actualizando campaña:', error);
    res.status(500).json({ error: 'Error al actualizar campaña' });
  }
});

// POST /campanas/:id/preparar-hoy
router.post('/:id/preparar-hoy', async (req, res) => {
  try {
    const campana = await prisma.campanaEnvio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    let envio = await prisma.envioRealizado.findFirst({
      where: { campanaId: campana.id, fechaProgramada: { gte: inicioDeHoy(), lte: finDeHoy() } },
    });

    if (!envio) {
      envio = await prisma.envioRealizado.create({
        data: { campanaId: campana.id, fechaProgramada: new Date(), estado: 'BORRADOR' },
      });
    }

    res.status(201).json({ envio });
  } catch (error) {
    console.error('Error preparando envío de hoy:', error);
    res.status(500).json({ error: 'Error al preparar el envío de hoy' });
  }
});

// GET /campanas/:id/estimar-envio
router.get('/:id/estimar-envio', async (req, res) => {
  try {
    const campana = await prisma.campanaEnvio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    const modoOperacion = await obtenerModoOperacion(req.usuario.empresaId);

    const clienteIdsOverride = req.query.clienteIds
      ? String(req.query.clienteIds).split(',').filter(Boolean)
      : null;

    const clientesDestino = await resolverDestinatariosFinales(
      req.usuario.empresaId,
      campana,
      modoOperacion,
      clienteIdsOverride
    );
    const costoEstimadoClp = Math.round(clientesDestino.length * TARIFA_CAMPANA_CATALOGO_CLP);

    const billetera = await prisma.billeteraCreditos.findUnique({
      where: { empresaId: req.usuario.empresaId },
    });
    const saldoActual = billetera ? billetera.saldoActual : 0;

    res.json({
      clientesSuscritos: clientesDestino.length,
      segmentada: clienteIdsOverride ? true : campana.segmentada,
      tarifaPorMensajeClp: TARIFA_CAMPANA_CATALOGO_CLP,
      costoEstimadoClp,
      categoria: 'MARKETING',
      saldoActual,
      saldoInsuficiente: saldoActual < clientesDestino.length,
    });
  } catch (error) {
    console.error('Error estimando costo de envío:', error);
    res.status(500).json({ error: 'Error al estimar el costo del envío' });
  }
});

// POST /campanas/:campanaId/envios/:envioId/enviar
router.post('/:campanaId/envios/:envioId/enviar', async (req, res) => {
  try {
    const { productoIds, clienteIds, mensajeDelDia } = req.body;

    const empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      include: { rubroTemplate: true },
    });
    const modoOperacion = empresa.rubroTemplate.modoOperacion;
    const esCatalogo = modoOperacion === 'CATALOGO_ROTATIVO';

    if (esCatalogo) {
      if (!Array.isArray(productoIds) || productoIds.length === 0) {
        return res.status(400).json({ error: 'Debes elegir al menos un producto para este envío' });
      }
      if (mensajeDelDia && mensajeDelDia.length > LIMITE_MENSAJE_CATALOGO) {
        return res.status(400).json({
          error: `El mensaje del día no puede superar los ${LIMITE_MENSAJE_CATALOGO} caracteres`,
          largoActual: mensajeDelDia.length,
        });
      }
    } else {
      if (!mensajeDelDia || !mensajeDelDia.trim()) {
        return res.status(400).json({ error: 'Debes escribir el mensaje de este envío' });
      }
      if (mensajeDelDia.length > LIMITE_MENSAJE_AGENDAMIENTO) {
        return res.status(400).json({
          error: `El mensaje no puede superar los ${LIMITE_MENSAJE_AGENDAMIENTO} caracteres`,
          largoActual: mensajeDelDia.length,
        });
      }
    }

    const envio = await prisma.envioRealizado.findFirst({
      where: { id: req.params.envioId, campanaId: req.params.campanaId, campana: { empresaId: empresa.id } },
      include: { campana: true },
    });

    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (envio.estado === 'ENVIADO') {
      return res.status(409).json({ error: 'Este envío ya fue realizado' });
    }

    if (!empresa.whatsappNumeroId) {
      return res.status(400).json({ error: 'Esta empresa no tiene un número de WhatsApp conectado todavía' });
    }

    const accessToken = empresa.whatsappToken || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(400).json({ error: 'Esta empresa no tiene un token de WhatsApp configurado' });
    }

    let productosOfrecidosJson = null;
    if (esCatalogo) {
      const productos = await prisma.producto.findMany({
        where: { id: { in: productoIds }, empresaId: empresa.id },
      });
      productosOfrecidosJson = productos.map((p) => ({
        productoId: p.id,
        nombre: p.nombre,
        precio: p.precio,
        unidad: p.unidad,
      }));
    }

    const clientes = await resolverDestinatariosFinales(empresa.id, envio.campana, modoOperacion, clienteIds);

    if (clientes.length === 0) {
      return res.status(400).json({ error: 'No hay destinatarios para este envío' });
    }

    const billeteraPrevia = await prisma.billeteraCreditos.findUnique({
      where: { empresaId: empresa.id },
    });
    const saldoPrevio = billeteraPrevia ? billeteraPrevia.saldoActual : 0;

    if (saldoPrevio < clientes.length) {
      return res.status(402).json({
        error: 'Saldo de créditos insuficiente para este envío',
        saldoActual: saldoPrevio,
        creditosNecesarios: clientes.length,
        creditosFaltantes: clientes.length - saldoPrevio,
      });
    }

    // AJUSTAR: confirma con el template real aprobado en Meta cuál es el
    // orden correcto de variables.
    const variablesTemplate = esCatalogo
      ? [
          (cliente) => cliente.nombre,
          () => empresa.nombre,
          () => mensajeDelDia || '¡Mira el catálogo de hoy!',
        ]
      : [
          (cliente) => cliente.nombre,
          () => empresa.nombre,
          () => mensajeDelDia,
        ];

    let enviados = 0;
    let fallidos = 0;

    for (const cliente of clientes) {
      try {
        await sendWhatsAppTemplateMessage({
          phoneNumberId: empresa.whatsappNumeroId,
          to: cliente.telefono,
          accessToken,
          templateName: esCatalogo ? envio.campana.plantillaWhatsapp : PLANTILLA_REACTIVO_FIJA,
          variables: variablesTemplate.map((fn) => fn(cliente)),
        });
        enviados++;
      } catch (error) {
        fallidos++;
        console.error(`Error enviando campaña a ${cliente.nombre}:`, error.message);
      }
    }

    if (enviados === 0) {
      return res.status(502).json({ error: 'No se pudo enviar a ningún destinatario', fallidos });
    }

    const costoRealClp = Math.round(enviados * TARIFA_CAMPANA_CATALOGO_CLP);

    const resultado = await prisma.$transaction(async (tx) => {
      const billeteraActual = await tx.billeteraCreditos.findUnique({
        where: { empresaId: empresa.id },
      });

      if (!billeteraActual || billeteraActual.saldoActual < enviados) {
        throw new Error('SALDO_INSUFICIENTE_EN_TRANSACCION');
      }

      const nuevoSaldo = billeteraActual.saldoActual - enviados;

      await tx.billeteraCreditos.update({
        where: { id: billeteraActual.id },
        data: { saldoActual: nuevoSaldo },
      });

      await tx.movimientoCredito.create({
        data: {
          billeteraId: billeteraActual.id,
          tipo: 'CONSUMO',
          cantidad: -enviados,
          saldoResultante: nuevoSaldo,
          nota: `Envío campaña "${envio.campana.nombre}" — ${enviados} destinatarios`,
        },
      });

      const envioActualizado = await tx.envioRealizado.update({
        where: { id: envio.id },
        data: {
          estado: 'ENVIADO',
          productosOfrecidosJson,
          mensajeDelDia: mensajeDelDia || null,
          fechaHoraEnvio: new Date(),
          destinatariosCount: enviados,
          costoEstimadoClp: costoRealClp,
        },
      });

      return { nuevoSaldo, envioActualizado };
    });

    res.json({
      envio: resultado.envioActualizado,
      enviados,
      fallidos,
      costoClp: costoRealClp,
      saldoRestante: resultado.nuevoSaldo,
    });
  } catch (error) {
    if (error.message === 'SALDO_INSUFICIENTE_EN_TRANSACCION') {
      return res.status(402).json({ error: 'Saldo de créditos insuficiente (verificado al momento del envío)' });
    }
    console.error('Error enviando campaña:', error);
    res.status(500).json({ error: 'Error al enviar la campaña' });
  }
});

module.exports = router;