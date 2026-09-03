#!/usr/bin/env node
/**
 * Elimina las 3 empresas "Alejandro Barber" duplicadas y vacías (quedaron
 * de pruebas anteriores en la sesión) — la cuenta real es
 * 18ba4ab2-17bd-4044-b6f7-2859917de126 (usuario del panel + servicios +
 * WhatsApp conectado), que este script NUNCA toca.
 *
 * Por seguridad, antes de borrar cada empresa cuenta filas relacionadas en
 * TODAS las tablas que cuelgan de Empresa — si alguna tiene algo (aunque
 * el diagnóstico anterior haya mostrado 0 servicios/usuarios), se salta esa
 * empresa en vez de arriesgar un borrado a ciegas.
 *
 * Uso (Render Shell): node scripts/_eliminar-duplicados-alejandro-barber.js
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID_REAL = '18ba4ab2-17bd-4044-b6f7-2859917de126';
const IDS_A_ELIMINAR = [
  'd67d7d1e-59a3-4dbc-98ad-ae84f91a0111',
  'c8730827-a4f2-4956-897e-aef26dd7a53e',
  '8f583c44-6ff9-4e52-aa92-820a0c199a45',
];

// Todo modelo con un FK directo a Empresa (empresaId o, en el caso de
// DemoAsignada, empresaDemoId) — la primera pasada de este script se
// quedó corta (le faltaban CatalogoItem, BilleteraCreditos,
// OrdenCompraCreditos, DemoAsignada, WebsiteLeads) y reventó con un error
// de foreign key de Postgres al toparse con una fila en DemoAsignada que
// no había contado. Ahora recorre exactamente la lista de modelos que
// tienen ese FK en schema.prisma, para no volver a llevarse una sorpresa.
async function contarRelacionadas(empresaId) {
  const [
    usuarios, clientes, recursos, servicios, citas, listaEspera,
    conversaciones, ventas, productos, campanasEnvio, pedidos,
    catalogoCategorias, catalogoItems, suscripcion, historialSuscripcion,
    contratosAceptados, billeteraCreditos, ordenesCompraCreditos,
    demoAsignada, websiteLeads,
  ] = await Promise.all([
    prisma.usuario.count({ where: { empresaId } }),
    prisma.cliente.count({ where: { empresaId } }),
    prisma.recursoAgendable.count({ where: { empresaId } }),
    prisma.servicio.count({ where: { empresaId } }),
    prisma.cita.count({ where: { empresaId } }),
    prisma.listaEspera.count({ where: { empresaId } }),
    prisma.conversacion.count({ where: { empresaId } }),
    prisma.venta.count({ where: { empresaId } }),
    prisma.producto.count({ where: { empresaId } }),
    prisma.campanaEnvio.count({ where: { empresaId } }),
    prisma.pedido.count({ where: { empresaId } }),
    prisma.catalogoCategoria.count({ where: { empresaId } }),
    prisma.catalogoItem.count({ where: { empresaId } }),
    prisma.suscripcion.count({ where: { empresaId } }),
    prisma.historialSuscripcion.count({ where: { empresaId } }),
    prisma.contratoAceptado.count({ where: { empresaId } }),
    prisma.billeteraCreditos.count({ where: { empresaId } }),
    prisma.ordenCompraCreditos.count({ where: { empresaId } }),
    prisma.demoAsignada.count({ where: { empresaDemoId: empresaId } }),
    prisma.websiteLeads.count({ where: { empresaId } }),
  ]);
  return {
    usuarios, clientes, recursos, servicios, citas, listaEspera,
    conversaciones, ventas, productos, campanasEnvio, pedidos,
    catalogoCategorias, catalogoItems, suscripcion, historialSuscripcion,
    contratosAceptados, billeteraCreditos, ordenesCompraCreditos,
    demoAsignada, websiteLeads,
  };
}

async function main() {
  for (const id of IDS_A_ELIMINAR) {
    if (id === EMPRESA_ID_REAL) throw new Error('IDS_A_ELIMINAR no debe incluir la empresa real — abortando.');

    const empresa = await prisma.empresa.findUnique({ where: { id }, select: { id: true, nombre: true } });
    if (!empresa) {
      console.log(`${id}: ya no existe, se salta.`);
      continue;
    }

    const conteos = await contarRelacionadas(id);
    const totalRelacionado = Object.values(conteos).reduce((a, b) => a + b, 0);

    if (totalRelacionado > 0) {
      console.log(`${empresa.nombre} (${id}): tiene datos relacionados, NO se elimina.`, conteos);
      continue;
    }

    try {
      await prisma.empresa.delete({ where: { id } });
      console.log(`${empresa.nombre} (${id}): eliminada (sin ningún dato relacionado).`);
    } catch (error) {
      console.error(`${empresa.nombre} (${id}): error al eliminar, se sigue con las demás:`, error.message);
    }
  }
}
main().catch((e) => console.error('ERROR:', e)).finally(() => prisma.$disconnect());
