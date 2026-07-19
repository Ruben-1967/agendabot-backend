// Motor de catálogo rotativo SIMPLIFICADO, exclusivo para demos
// comerciales. A diferencia de pedidosEngine.js (el motor real, que
// depende de CampanaEnvio/EnvioRealizado y envía WhatsApp directamente),
// este lee Producto sin intermediarios y retorna {respuestaTexto,
// interactivo} — el mismo contrato que usa demoEngine.js para todo lo
// demás, para que server.js pueda enviarlo con las credenciales de demo.
//
// No se usa NUNCA para negocios reales — pedidosEngine.js sigue siendo
// el único motor de catálogo rotativo en producción.

const prisma = require('../lib/prisma');

const MAX_PRODUCTOS_EN_LISTA = 10; // límite real de WhatsApp por lista interactiva

function esNumeroSimple(texto) {
  return /^\s*\d+\s*$/.test(texto || '');
}

/**
 * @returns {Promise<{respuestaTexto: string, interactivo: Object|null}>}
 */
async function procesarMensajeCatalogoDemo({ empresaDemo, textoEntrante }) {
  const pideMenu = /menu|menú|hola|pedido|productos|cat[aá]logo/i.test(textoEntrante || '') || !textoEntrante;

  if (pideMenu) {
    const productos = await prisma.producto.findMany({
      where: { empresaId: empresaDemo.id, activo: true },
      orderBy: { nombre: 'asc' },
      take: MAX_PRODUCTOS_EN_LISTA,
    });

    if (productos.length === 0) {
      return {
        respuestaTexto: `Todavía no tenemos productos cargados para esta demo de "${empresaDemo.nombre}". Esto normalmente se completa automáticamente si el negocio tiene sitio web, o se carga manualmente.`,
        interactivo: null,
      };
    }

    return {
      respuestaTexto: `Esto es lo que tenemos disponible hoy en ${empresaDemo.nombre} 👇`,
      interactivo: {
        tipo: 'lista_productos_demo',
        productos: productos.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          precio: p.precio,
        })),
      },
    };
  }

  // Cualquier otro mensaje (incluyendo selección simulada, ya que la demo
  // no procesa pedidos reales) — guiamos de vuelta al menú.
  return {
    respuestaTexto: 'Esto es solo una vista previa del catálogo — en tu negocio real, el cliente podría elegir productos, indicar cantidades y confirmar el pedido, todo automático. Escríbeme "menú" para ver el catálogo de nuevo.',
    interactivo: null,
  };
}

module.exports = { procesarMensajeCatalogoDemo };