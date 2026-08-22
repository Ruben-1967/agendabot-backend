// src/routes/clientes.js
//
// CRUD de Cliente/Paciente + registro de ventas/atenciones + segmentación
// para campañas. La ficha específica del rubro (ej. receta óptica) se
// arma dinámicamente desde RubroTemplate.camposFicha — el mismo cliente
// sirve para cualquier rubro sin código distinto por caso.
//
// GET  /clientes/config        -> camposFicha y categorías sugeridas del rubro de la empresa
// GET  /clientes/segmentacion  -> soporta AMBOS modos (ver más abajo)
// GET  /clientes                -> listado con resumen de compras
// GET  /clientes/:id            -> detalle + historial de ventas
// POST /clientes                -> crear
// PATCH /clientes/:id           -> editar (datos base + fichaJson)
// POST /clientes/:id/ventas     -> registrar una venta/atención nueva
//
// IMPORTANTE: /segmentacion debe declararse ANTES que /:id — si no,
// Express interpreta "segmentacion" como un id de cliente y la ruta
// correcta nunca se alcanza (bug real encontrado y corregido el 26 de
// julio, probaba "Cliente no encontrado" en vez de segmentar).

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'RECEPCION'));

// ------------------------------------------------------------
// GET /clientes/config — qué campos de ficha y categorías de producto
// corresponden al rubro de esta empresa, para armar el formulario dinámico
// en el panel sin código distinto por rubro.
// ------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      include: { rubroTemplate: true },
    });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

res.json({
      camposFicha: empresa.rubroTemplate.camposFicha || { grupos: [] },
      categoriasProductoSugeridas: Array.isArray(empresa.rubroTemplate.categoriasProductoSugeridas)
        ? empresa.rubroTemplate.categoriasProductoSugeridas
        : [],
    });

  } catch (error) {
    console.error('Error en GET /clientes/config:', error);
    res.status(500).json({ error: 'Error al obtener la configuración de clientes' });
  }
});

// ------------------------------------------------------------
// GET /clientes/segmentacion — soporta los 2 modos de operación:
// - CATALOGO_ROTATIVO: vía Pedido/PedidoItem/Producto
// - AGENDAMIENTO: vía Venta (categoriaProducto en vez de productoId)
//
// Declarada ANTES de /:id a propósito — ver nota al inicio del archivo.
// ------------------------------------------------------------
router.get('/segmentacion', async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { rubroTemplate: true },
    });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const dias = parseInt(req.query.dias) || 30;
    const montoMinimo = req.query.montoMinimo ? parseFloat(req.query.montoMinimo) : null;
    const minPedidos = req.query.minPedidos ? parseInt(req.query.minPedidos) : null;
    const productoId = req.query.productoId || null; // catálogo rotativo
    const categoriaProducto = req.query.categoriaProducto || null; // reactivos
    const diasSinComprar = req.query.diasSinComprar ? parseInt(req.query.diasSinComprar) : null;

    const fechaInicioPeriodo = new Date();
    fechaInicioPeriodo.setDate(fechaInicioPeriodo.getDate() - dias);
    const hoy = new Date();

    if (empresa.rubroTemplate.modoOperacion === 'CATALOGO_ROTATIVO') {
      // ---- Lógica original, sin cambios, vía Pedido ----
      const clientes = await prisma.cliente.findMany({
        where: { empresaId },
        include: {
          pedidos: {
            where: { creadoEn: { gte: fechaInicioPeriodo }, estado: { not: 'CANCELADO' } },
            include: { items: { include: { producto: true } } },
          },
        },
      });

      const ultimasCompras = await prisma.pedido.groupBy({
        by: ['clienteId'],
        where: { clienteId: { in: clientes.map((c) => c.id) }, estado: { not: 'CANCELADO' } },
        _max: { creadoEn: true },
      });
      const mapaUltimaCompra = new Map(ultimasCompras.map((u) => [u.clienteId, u._max.creadoEn]));

      let segmentados = clientes.map((c) => {
        const totalGastado = c.pedidos.reduce(
          (sp, p) => sp + p.items.reduce((si, i) => si + i.cantidad * i.precioUnitario, 0),
          0
        );
        const numPedidos = c.pedidos.length;
        const conteoProductos = {};
        c.pedidos.forEach((p) =>
          p.items.forEach((i) => {
            if (!conteoProductos[i.productoId]) conteoProductos[i.productoId] = { nombre: i.producto.nombre, cantidad: 0 };
            conteoProductos[i.productoId].cantidad += i.cantidad;
          })
        );
        const topEntry = Object.entries(conteoProductos).sort((a, b) => b[1].cantidad - a[1].cantidad)[0];
        const comproProductoFiltrado = productoId
          ? c.pedidos.some((p) => p.items.some((i) => i.productoId === productoId))
          : true;
        const ultimaCompraFecha = mapaUltimaCompra.get(c.id) || null;
        const diasDesdeUltimaCompra = ultimaCompraFecha
          ? Math.floor((hoy - new Date(ultimaCompraFecha)) / (1000 * 60 * 60 * 24))
          : null;

        return {
          clienteId: c.id,
          nombre: c.nombre,
          telefono: c.telefono,
          numPedidos,
          totalGastado,
          productoTopId: topEntry ? topEntry[0] : null,
          productoTopNombre: topEntry ? topEntry[1].nombre : null,
          ultimaCompraFecha,
          diasDesdeUltimaCompra,
          _comproProductoFiltrado: comproProductoFiltrado,
        };
      });

      if (montoMinimo !== null) segmentados = segmentados.filter((c) => c.totalGastado >= montoMinimo);
      if (minPedidos !== null) segmentados = segmentados.filter((c) => c.numPedidos >= minPedidos);
      if (productoId) segmentados = segmentados.filter((c) => c._comproProductoFiltrado);
      if (diasSinComprar !== null) {
        segmentados = segmentados.filter((c) => c.diasDesdeUltimaCompra === null || c.diasDesdeUltimaCompra >= diasSinComprar);
      }
      segmentados = segmentados.map(({ _comproProductoFiltrado, ...resto }) => resto);

      return res.json({ periodoDias: dias, totalClientes: segmentados.length, clientes: segmentados });
    }

    // ---- Modo AGENDAMIENTO: vía Venta, con categoriaProducto ----
    const clientes = await prisma.cliente.findMany({
      where: { empresaId },
      include: {
        ventas: {
          where: { fecha: { gte: fechaInicioPeriodo } },
          orderBy: { fecha: 'desc' },
        },
      },
    });

    const ultimasVentas = await prisma.venta.groupBy({
      by: ['clienteId'],
      where: { clienteId: { in: clientes.map((c) => c.id) } },
      _max: { fecha: true },
    });
    const mapaUltimaVenta = new Map(ultimasVentas.map((u) => [u.clienteId, u._max.fecha]));

    let segmentados = clientes.map((c) => {
      const totalGastado = c.ventas.reduce((acc, v) => acc + v.monto, 0);
      const numVentas = c.ventas.length;
      const conteoCategorias = {};
      c.ventas.forEach((v) => {
        if (!v.categoriaProducto) return;
        conteoCategorias[v.categoriaProducto] = (conteoCategorias[v.categoriaProducto] || 0) + 1;
      });
      const topEntry = Object.entries(conteoCategorias).sort((a, b) => b[1] - a[1])[0];
      const comproCategoriaFiltrada = categoriaProducto
        ? c.ventas.some((v) => v.categoriaProducto === categoriaProducto)
        : true;
      const ultimaCompraFecha = mapaUltimaVenta.get(c.id) || null;
      const diasDesdeUltimaCompra = ultimaCompraFecha
        ? Math.floor((hoy - new Date(ultimaCompraFecha)) / (1000 * 60 * 60 * 24))
        : null;

      return {
        clienteId: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        numPedidos: numVentas, // mismo nombre de campo que el panel ya espera
        totalGastado,
        productoTopId: null,
        productoTopNombre: topEntry ? topEntry[0] : null,
        ultimaCompraFecha,
        diasDesdeUltimaCompra,
        _comproCategoriaFiltrada: comproCategoriaFiltrada,
      };
    });

    if (montoMinimo !== null) segmentados = segmentados.filter((c) => c.totalGastado >= montoMinimo);
    if (minPedidos !== null) segmentados = segmentados.filter((c) => c.numPedidos >= minPedidos);
    if (categoriaProducto) segmentados = segmentados.filter((c) => c._comproCategoriaFiltrada);
    if (diasSinComprar !== null) {
      segmentados = segmentados.filter((c) => c.diasDesdeUltimaCompra === null || c.diasDesdeUltimaCompra >= diasSinComprar);
    }
    segmentados = segmentados.map(({ _comproCategoriaFiltrada, ...resto }) => resto);

    res.json({ periodoDias: dias, totalClientes: segmentados.length, clientes: segmentados });
  } catch (error) {
    console.error('Error en /clientes/segmentacion:', error);
    res.status(500).json({ error: 'Error al calcular la segmentación de clientes' });
  }
});

// ------------------------------------------------------------
// GET /clientes — listado con resumen (última compra, total gastado)
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const clientes = await prisma.cliente.findMany({
      where: { empresaId },
      include: { ventas: { orderBy: { fecha: 'desc' } } },
      orderBy: { nombre: 'asc' },
    });

    const resultado = clientes.map((c) => {
      const totalGastado = c.ventas.reduce((acc, v) => acc + v.monto, 0);
      return {
        id: c.id,
        nombre: c.nombre,
        rut: c.rut,
        telefono: c.telefono,
        email: c.email,
        numVentas: c.ventas.length,
        totalGastado,
        ultimaCompraFecha: c.ventas[0]?.fecha || null,
      };
    });

    res.json({ clientes: resultado });
  } catch (error) {
    console.error('Error listando clientes:', error);
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

// ------------------------------------------------------------
// GET /clientes/:id — detalle completo + historial de ventas
// ------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
      include: { ventas: { orderBy: { fecha: 'desc' } } },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    res.json({ cliente });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({ error: 'Error al obtener el cliente' });
  }
});

// ------------------------------------------------------------
// POST /clientes — crear
// ------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { nombre, rut, telefono, email, fechaNacimiento, fichaJson } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre del cliente' });
    }

    const cliente = await prisma.cliente.create({
      data: {
        empresaId: req.usuario.empresaId,
        nombre: nombre.trim(),
        rut: rut || null,
        telefono: telefono || null,
        email: email || null,
        fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : null,
        fichaJson: fichaJson || null,
      },
    });

    res.status(201).json({ cliente });
  } catch (error) {
    console.error('Error creando cliente:', error);
    res.status(500).json({ error: 'Error al crear el cliente' });
  }
});

// ------------------------------------------------------------
// PATCH /clientes/:id — editar datos base + ficha del rubro
// ------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const {
      nombre, rut, telefono, email, fechaNacimiento, fichaJson,
      fechaProximaCita, profesionalAtendio, diagnostico,
    } = req.body;

    const actualizado = await prisma.cliente.update({
      where: { id: cliente.id },
      data: {
        ...(nombre !== undefined && { nombre: nombre.trim() }),
        ...(rut !== undefined && { rut: rut || null }),
        ...(telefono !== undefined && { telefono: telefono || null }),
        ...(email !== undefined && { email: email || null }),
        ...(fechaNacimiento !== undefined && {
          fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : null,
        }),
        ...(fichaJson !== undefined && { fichaJson }),
        ...(fechaProximaCita !== undefined && {
          fechaProximaCita: fechaProximaCita ? new Date(fechaProximaCita) : null,
        }),
        ...(profesionalAtendio !== undefined && { profesionalAtendio: profesionalAtendio || null }),
        ...(diagnostico !== undefined && { diagnostico: diagnostico || null }),
      },
    });

    res.json({ cliente: actualizado });
  } catch (error) {
    console.error('Error actualizando cliente:', error);
    res.status(500).json({ error: 'Error al actualizar el cliente' });
  }
});

// ------------------------------------------------------------
// POST /clientes/:id/ventas — registrar una compra/atención nueva
// ------------------------------------------------------------
router.post('/:id/ventas', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const { descripcion, monto, categoriaProducto, fecha } = req.body;

    if (!descripcion || !descripcion.trim()) {
      return res.status(400).json({ error: 'Falta la descripción de la venta' });
    }
    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum < 0) {
      return res.status(400).json({ error: 'monto debe ser un número válido' });
    }

    const venta = await prisma.venta.create({
      data: {
        empresaId: req.usuario.empresaId,
        clienteId: cliente.id,
        descripcion: descripcion.trim(),
        monto: Math.round(montoNum),
        categoriaProducto: categoriaProducto || null,
        estadoPago: 'PAGADO',
        fecha: fecha ? new Date(fecha) : new Date(),
      },
    });

    res.status(201).json({ venta });
  } catch (error) {
    console.error('Error registrando venta:', error);
    res.status(500).json({ error: 'Error al registrar la venta' });
  }
});

// ------------------------------------------------------------
// PATCH /clientes/:id/ventas/:ventaId — edita una venta ya registrada
// (fecha, descripción, monto, categoría). No existía ninguna forma de
// corregir una venta después de creada hasta ahora.
// ------------------------------------------------------------
router.patch('/:id/ventas/:ventaId', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const venta = await prisma.venta.findFirst({
      where: { id: req.params.ventaId, clienteId: cliente.id, empresaId: req.usuario.empresaId },
    });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const { descripcion, monto, categoriaProducto, fecha } = req.body;

    if (descripcion !== undefined && !descripcion.trim()) {
      return res.status(400).json({ error: 'La descripción no puede quedar vacía' });
    }
    let montoNum;
    if (monto !== undefined) {
      montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum < 0) {
        return res.status(400).json({ error: 'monto debe ser un número válido' });
      }
    }

    const ventaActualizada = await prisma.venta.update({
      where: { id: venta.id },
      data: {
        ...(descripcion !== undefined && { descripcion: descripcion.trim() }),
        ...(montoNum !== undefined && { monto: Math.round(montoNum) }),
        ...(categoriaProducto !== undefined && { categoriaProducto: categoriaProducto || null }),
        ...(fecha !== undefined && { fecha: new Date(fecha) }),
      },
    });

    res.json({ venta: ventaActualizada });
  } catch (error) {
    console.error('Error editando venta:', error);
    res.status(500).json({ error: 'Error al editar la venta' });
  }
});

// ------------------------------------------------------------
// Helper: recalcula el "caché" en Cliente (fichaJson, diagnostico,
// profesionalAtendio, fechaProximaCita) a partir de la AtencionClinica
// más reciente por fecha. Se llama tras crear/editar/eliminar una atención.
// Si no queda ninguna atención, limpia el caché a null.
// ------------------------------------------------------------
async function recalcularCacheCliente(clienteId) {
  const masReciente = await prisma.atencionClinica.findFirst({
    where: { clienteId },
    orderBy: { fecha: 'desc' },
  });

  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      fichaJson: masReciente ? masReciente.fichaJson : null,
      diagnostico: masReciente ? masReciente.diagnostico : null,
      profesionalAtendio: masReciente ? masReciente.profesionalAtendio : null,
      fechaProximaCita: masReciente ? masReciente.fechaProximaCitaFijada : null,
    },
  });
}

// ------------------------------------------------------------
// GET /clientes/:id/atenciones — historial completo, más reciente primero
// ------------------------------------------------------------
router.get('/:id/atenciones', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const atenciones = await prisma.atencionClinica.findMany({
      where: { clienteId: cliente.id },
      orderBy: { fecha: 'desc' },
    });

    res.json({ atenciones });
  } catch (error) {
    console.error('Error listando atenciones clínicas:', error);
    res.status(500).json({ error: 'Error al listar las atenciones clínicas' });
  }
});

// Recordatorio escalonado del próximo control (Fichas dinámicas +
// Recordatorios escalonados): recordatorioModo se calcula UNA SOLA VEZ, en
// el momento en que se fija/cambia fechaProximaCitaFijada, según la
// anticipación medida desde HOY (no desde la fecha de la atención) — no se
// recalcula después aunque pase el tiempo. Cualquier cambio de fecha
// reinicia el ciclo (los pasos 1/2 vuelven a null), porque es efectivamente
// un nuevo control. Sin fecha, no hay ciclo de recordatorio.
const DIAS_LIMITE_RECORDATORIO_SIMPLE = 21; // 3 semanas

function calcularCamposRecordatorio(fechaProximaCitaFijada) {
  if (!fechaProximaCitaFijada) {
    return {
      recordatorioModo: null,
      recordatorioPaso1EnviadoEn: null,
      recordatorioPaso1Confirmado: null,
      recordatorioPaso2EnviadoEn: null,
      recordatorioPaso2Confirmado: null,
    };
  }

  const diasAnticipacion = (fechaProximaCitaFijada - new Date()) / (1000 * 60 * 60 * 24);
  const recordatorioModo = diasAnticipacion <= DIAS_LIMITE_RECORDATORIO_SIMPLE ? 'SIMPLE' : 'ESCALONADO';

  return {
    recordatorioModo,
    recordatorioPaso1EnviadoEn: null,
    recordatorioPaso1Confirmado: null,
    recordatorioPaso2EnviadoEn: null,
    recordatorioPaso2Confirmado: null,
  };
}

// ------------------------------------------------------------
// POST /clientes/:id/atenciones — registra una atención nueva
// ------------------------------------------------------------
router.post('/:id/atenciones', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const { fecha, fichaJson, diagnostico, profesionalAtendio, fechaProximaCitaFijada } = req.body;

    if (!fecha) {
      return res.status(400).json({ error: 'Falta la fecha de la atención' });
    }

    const fechaProximaCitaFijadaDate = fechaProximaCitaFijada ? new Date(fechaProximaCitaFijada) : null;

    const atencion = await prisma.atencionClinica.create({
      data: {
        clienteId: cliente.id,
        fecha: new Date(fecha),
        fichaJson: fichaJson || null,
        diagnostico: diagnostico || null,
        profesionalAtendio: profesionalAtendio || null,
        fechaProximaCitaFijada: fechaProximaCitaFijadaDate,
        ...calcularCamposRecordatorio(fechaProximaCitaFijadaDate),
      },
    });

    await recalcularCacheCliente(cliente.id);

    res.status(201).json({ atencion });
  } catch (error) {
    console.error('Error creando atención clínica:', error);
    res.status(500).json({ error: 'Error al crear la atención clínica' });
  }
});

// ------------------------------------------------------------
// PATCH /clientes/:id/atenciones/:atencionId — edita una atención existente
// ------------------------------------------------------------
router.patch('/:id/atenciones/:atencionId', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const atencionExistente = await prisma.atencionClinica.findFirst({
      where: { id: req.params.atencionId, clienteId: cliente.id },
    });
    if (!atencionExistente) return res.status(404).json({ error: 'Atención no encontrada' });

    const { fecha, fichaJson, diagnostico, profesionalAtendio, fechaProximaCitaFijada } = req.body;

    // Solo se recalcula el ciclo de recordatorio si esta edición realmente
    // toca fechaProximaCitaFijada — si no viene en el body, se deja el
    // ciclo existente intacto (no se reinicia por editar otro campo).
    let fechaProximaCitaFijadaDate;
    if (fechaProximaCitaFijada !== undefined) {
      fechaProximaCitaFijadaDate = fechaProximaCitaFijada ? new Date(fechaProximaCitaFijada) : null;
    }

    const actualizada = await prisma.atencionClinica.update({
      where: { id: atencionExistente.id },
      data: {
        ...(fecha !== undefined && { fecha: new Date(fecha) }),
        ...(fichaJson !== undefined && { fichaJson }),
        ...(diagnostico !== undefined && { diagnostico: diagnostico || null }),
        ...(profesionalAtendio !== undefined && { profesionalAtendio: profesionalAtendio || null }),
        ...(fechaProximaCitaFijada !== undefined && {
          fechaProximaCitaFijada: fechaProximaCitaFijadaDate,
          ...calcularCamposRecordatorio(fechaProximaCitaFijadaDate),
        }),
      },
    });

    await recalcularCacheCliente(cliente.id);

    res.json({ atencion: actualizada });
  } catch (error) {
    console.error('Error actualizando atención clínica:', error);
    res.status(500).json({ error: 'Error al actualizar la atención clínica' });
  }
});

// ------------------------------------------------------------
// DELETE /clientes/:id/atenciones/:atencionId — elimina una atención
// (el frontend debe pedir confirmación antes de llamar esta ruta)
// ------------------------------------------------------------
router.delete('/:id/atenciones/:atencionId', async (req, res) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.usuario.empresaId },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const atencionExistente = await prisma.atencionClinica.findFirst({
      where: { id: req.params.atencionId, clienteId: cliente.id },
    });
    if (!atencionExistente) return res.status(404).json({ error: 'Atención no encontrada' });

    await prisma.atencionClinica.delete({ where: { id: atencionExistente.id } });

    await recalcularCacheCliente(cliente.id);

    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando atención clínica:', error);
    res.status(500).json({ error: 'Error al eliminar la atención clínica' });
  }
});


module.exports = router;