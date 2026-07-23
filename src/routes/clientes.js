// src/routes/clientes.js
//
// CRUD de Cliente/Paciente + registro de ventas/atenciones + segmentación
// para campañas. La ficha específica del rubro (ej. receta óptica) se
// arma dinámicamente desde RubroTemplate.camposFicha — el mismo cliente
// sirve para cualquier rubro sin código distinto por caso.
//
// GET  /clientes/config        -> camposFicha y categorías sugeridas del rubro de la empresa
// GET  /clientes                -> listado con resumen de compras
// GET  /clientes/:id            -> detalle + historial de ventas
// POST /clientes                -> crear
// PATCH /clientes/:id           -> editar (datos base + fichaJson)
// POST /clientes/:id/ventas     -> registrar una venta/atención nueva
// GET  /clientes/segmentacion   -> igual que antes, ahora soporta AMBOS modos

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
      camposFicha: Array.isArray(empresa.rubroTemplate.camposFicha) ? empresa.rubroTemplate.camposFicha : [],
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
// GET /clientes — listado con resumen (última compra, total gastado)
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const empresaId = req.usuario.empresaId;

    const clientes = await prisma.cliente.findMany({
      where: { empresaId },
      include: { ventas: { orderBy: { creadoEn: 'desc' } } },
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
        ultimaCompraFecha: c.ventas[0]?.creadoEn || null,
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
      include: { ventas: { orderBy: { creadoEn: 'desc' } } },
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

    const { nombre, rut, telefono, email, fechaNacimiento, fichaJson } = req.body;

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

    const { descripcion, monto, categoriaProducto } = req.body;

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
      },
    });

    res.status(201).json({ venta });
  } catch (error) {
    console.error('Error registrando venta:', error);
    res.status(500).json({ error: 'Error al registrar la venta' });
  }
});

// ------------------------------------------------------------
// GET /clientes/segmentacion — ahora soporta los 2 modos de operación:
// - CATALOGO_ROTATIVO: igual que antes, vía Pedido/PedidoItem/Producto
// - AGENDAMIENTO: nuevo, vía Venta (categoriaProducto en vez de productoId)
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
          where: { creadoEn: { gte: fechaInicioPeriodo } },
          orderBy: { creadoEn: 'desc' },
        },
      },
    });

    const ultimasVentas = await prisma.venta.groupBy({
      by: ['clienteId'],
      where: { clienteId: { in: clientes.map((c) => c.id) } },
      _max: { creadoEn: true },
    });
    const mapaUltimaVenta = new Map(ultimasVentas.map((u) => [u.clienteId, u._max.creadoEn]));

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

module.exports = router;