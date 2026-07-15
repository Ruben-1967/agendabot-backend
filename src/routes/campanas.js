const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { TARIFA_CAMPANA_CATALOGO_CLP } = require('../lib/costosWhatsapp');

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

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

/**
 * Resuelve la lista de clientes que deberían recibir un envío de esta
 * campaña. Si la campaña no está segmentada, es simplemente todos los
 * clientes con optInCampanas=true. Si está segmentada, además exige que en
 * los últimos `segmentoDias` el cliente haya gastado al menos
 * `segmentoMontoMinimoClp` y/o comprado alguno de `segmentoProductoIds`.
 */
async function resolverClientesDestino(empresaId, campana) {
  const todos = await prisma.cliente.findMany({
    where: { empresaId, optInCampanas: true, telefono: { not: null } },
  });

  if (!campana.segmentada) return todos;

  const dias = campana.segmentoDias || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const clientesConHistorial = await prisma.cliente.findMany({
    where: { id: { in: todos.map((c) => c.id) } },
    include: {
      pedidos: {
        where: { empresaId, creadoEn: { gte: desde }, estado: { not: 'CANCELADO' } },
        include: { items: true },
      },
    },
  });

  return clientesConHistorial
    .filter((cliente) => {
      const totalGastado = cliente.pedidos.reduce(
        (acc, p) => acc + p.items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0),
        0
      );

      const cumpleMonto = campana.segmentoMontoMinimoClp
        ? totalGastado >= campana.segmentoMontoMinimoClp
        : true;

      const cumpleProducto = campana.segmentoProductoIds && campana.segmentoProductoIds.length > 0
        ? cliente.pedidos.some((p) => p.items.some((it) => campana.segmentoProductoIds.includes(it.productoId)))
        : true;

      return cumpleMonto && cumpleProducto;
    })
    .map(({ pedidos, ...cliente }) => cliente); // no necesitamos devolver el historial completo
}

// GET /campanas — lista de campañas de la empresa, con el envío de HOY si ya existe
// (BORRADOR esperando que el admin elija productos, o ENVIADO si ya se mandó)
router.get('/', async (req, res) => {
  try {
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
        envioDeHoy: c.enviosRealizados[0] || null,
        enviosRealizados: undefined,
      })),
    });
  } catch (error) {
    console.error('Error listando campañas:', error);
    res.status(500).json({ error: 'Error al listar campañas' });
  }
});

// POST /campanas — crear una campaña nueva
router.post('/', async (req, res) => {
  try {
    const {
      nombre, diasSemana, hora, plantillaWhatsapp,
      segmentada, segmentoDias, segmentoMontoMinimoClp, segmentoProductoIds,
    } = req.body;

    if (!nombre || !Array.isArray(diasSemana) || !hora || !plantillaWhatsapp) {
      return res.status(400).json({ error: 'Faltan campos: nombre, diasSemana, hora, plantillaWhatsapp' });
    }

    const campana = await prisma.campanaEnvio.create({
      data: {
        empresaId: req.usuario.empresaId,
        nombre,
        diasSemana: diasSemana.map(Number),
        hora,
        plantillaWhatsapp,
        segmentada: Boolean(segmentada),
        segmentoDias: segmentada ? (Number(segmentoDias) || 30) : null,
        segmentoMontoMinimoClp: segmentada && segmentoMontoMinimoClp ? Number(segmentoMontoMinimoClp) : null,
        segmentoProductoIds: segmentada && Array.isArray(segmentoProductoIds) ? segmentoProductoIds : [],
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
      segmentada, segmentoDias, segmentoMontoMinimoClp, segmentoProductoIds,
    } = req.body;

    const actualizada = await prisma.campanaEnvio.update({
      where: { id: campana.id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(diasSemana !== undefined && { diasSemana: diasSemana.map(Number) }),
        ...(hora !== undefined && { hora }),
        ...(plantillaWhatsapp !== undefined && { plantillaWhatsapp }),
        ...(activa !== undefined && { activa: Boolean(activa) }),
        ...(segmentada !== undefined && { segmentada: Boolean(segmentada) }),
        ...(segmentoDias !== undefined && { segmentoDias: segmentoDias ? Number(segmentoDias) : null }),
        ...(segmentoMontoMinimoClp !== undefined && {
          segmentoMontoMinimoClp: segmentoMontoMinimoClp ? Number(segmentoMontoMinimoClp) : null,
        }),
        ...(segmentoProductoIds !== undefined && {
          segmentoProductoIds: Array.isArray(segmentoProductoIds) ? segmentoProductoIds : [],
        }),
      },
    });

    res.json({ campana: actualizada });
  } catch (error) {
    console.error('Error actualizando campaña:', error);
    res.status(500).json({ error: 'Error al actualizar campaña' });
  }
});

// POST /campanas/:id/preparar-hoy — crea manualmente el EnvioRealizado BORRADOR
// de hoy si todavía no existe (el cron lo hace automático a la hora configurada;
// esto sirve para adelantarlo o para probar sin esperar el cron).
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

// GET /campanas/:id/estimar-envio — cuántos clientes recibirían el mensaje
// hoy y cuánto costaría, ANTES de dispararlo. Si la campaña está segmentada,
// el conteo ya refleja solo a quienes cumplen el filtro de compra — la
// segmentación reduce directamente el costo real de Meta.
router.get('/:id/estimar-envio', async (req, res) => {
  try {
    const campana = await prisma.campanaEnvio.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

    const clientesDestino = await resolverClientesDestino(req.usuario.empresaId, campana);
    const costoEstimadoClp = Math.round(clientesDestino.length * TARIFA_CAMPANA_CATALOGO_CLP);

    res.json({
      clientesSuscritos: clientesDestino.length,
      segmentada: campana.segmentada,
      tarifaPorMensajeClp: TARIFA_CAMPANA_CATALOGO_CLP,
      costoEstimadoClp,
      categoria: 'MARKETING',
    });
  } catch (error) {
    console.error('Error estimando costo de envío:', error);
    res.status(500).json({ error: 'Error al estimar el costo del envío' });
  }
});

// POST /campanas/:campanaId/envios/:envioId/enviar
// El admin eligió los productos de este envío específico -> dispara el
// mensaje de plantilla a los clientes destino (todos los suscritos, o solo
// el segmento definido en la campaña si está segmentada).
router.post('/:campanaId/envios/:envioId/enviar', async (req, res) => {
  try {
    const { productoIds } = req.body;

    if (!Array.isArray(productoIds) || productoIds.length === 0) {
      return res.status(400).json({ error: 'Debes elegir al menos un producto para este envío' });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: req.usuario.empresaId } });

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

    const productos = await prisma.producto.findMany({
      where: { id: { in: productoIds }, empresaId: empresa.id },
    });

    const productosOfrecidosJson = productos.map((p) => ({
      productoId: p.id,
      nombre: p.nombre,
      precio: p.precio,
      unidad: p.unidad,
    }));

    const clientes = await resolverClientesDestino(empresa.id, envio.campana);

    let enviados = 0;
    let fallidos = 0;

    for (const cliente of clientes) {
      try {
        await sendWhatsAppTemplateMessage({
          phoneNumberId: empresa.whatsappNumeroId,
          to: cliente.telefono,
          accessToken,
          templateName: envio.campana.plantillaWhatsapp,
          variables: [cliente.nombre, empresa.nombre],
        });
        enviados++;
      } catch (error) {
        fallidos++;
        console.error(`Error enviando campaña a ${cliente.nombre}:`, error.message);
      }
    }

    const envioActualizado = await prisma.envioRealizado.update({
      where: { id: envio.id },
      data: {
        estado: 'ENVIADO',
        productosOfrecidosJson,
        fechaHoraEnvio: new Date(),
        destinatariosCount: enviados,
        costoEstimadoClp: Math.round(enviados * TARIFA_CAMPANA_CATALOGO_CLP),
      },
    });

    res.json({ envio: envioActualizado, enviados, fallidos, costoClp: envioActualizado.costoEstimadoClp });
  } catch (error) {
    console.error('Error enviando campaña:', error);
    res.status(500).json({ error: 'Error al enviar la campaña' });
  }
});

module.exports = router;
