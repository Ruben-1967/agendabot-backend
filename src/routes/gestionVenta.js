/**
 * src/routes/gestionVenta.js
 *
 * Árbol de gestión de ventas (arbol-gestion-ventas-DISENO.md) — CRM de
 * seguimiento paralelo al bot, sección propia del panel de vendedor (no
 * mezclada con /demos). Cada acción es una fila nueva en EventoGestionVenta,
 * editable/eliminable individualmente; nunca se sobrescribe.
 *
 * Regla crítica: nada acá toca rankingService.js ni Suscripcion. El único
 * evento que cuenta como conversión real sigue siendo la activación de pago
 * (ver src/routes/adminVendedores.js, marcar-activa).
 */
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CATALOGO_RESULTADOS, CATALOGO_MOTIVOS_DESCARTE, obtenerResultado, esMotivoDescarteValido } = require('../services/catalogoGestionVenta');
const { intentarRepoblarCupo } = require('../services/distribucionLeadsService');

const router = express.Router();

// Recalcula los campos derivados de DemoAsignada a partir de TODOS sus
// EventoGestionVenta vigentes — se llama después de crear, editar o borrar
// un evento, para que la edición/eliminación individual (requerida por el
// diseño) mantenga todo consistente sin parchear campos a mano.
async function recomputarDerivadosDemo(demoAsignadaId, tx) {
  const eventos = await tx.eventoGestionVenta.findMany({
    where: { demoAsignadaId },
    orderBy: { creadoEn: 'asc' },
    select: { creadoEn: true, reseteaTimer: true, resultado: true },
  });

  const primerEvento = eventos[0] || null;
  const eventosQueResetean = eventos.filter((e) => e.reseteaTimer);
  const ultimoQueResetea = eventosQueResetean[eventosQueResetean.length - 1] || null;
  const eventosCierre = eventos.filter((e) => e.resultado === 'cerrado_perdido');
  const ultimoCierre = eventosCierre[eventosCierre.length - 1] || null;

  const demoAntes = await tx.demoAsignada.findUnique({ where: { id: demoAsignadaId }, select: { cerradaEn: true } });
  const nuevaCerradaEn = ultimoCierre ? ultimoCierre.creadoEn : null;

  const demoActualizada = await tx.demoAsignada.update({
    where: { id: demoAsignadaId },
    data: {
      primerContactoVendedorEn: primerEvento ? primerEvento.creadoEn : null,
      ultimoContactoEfectivoEn: ultimoQueResetea ? ultimoQueResetea.creadoEn : null,
      cerradaEn: nuevaCerradaEn,
    },
  });

  // Señal para que el caller (fuera de la transacción, una vez que ya
  // commiteó) intente repoblar el cupo del vendedor — recién ahí el conteo
  // de "casos activos" refleja este cierre.
  const seCerroRecienAhora = !demoAntes.cerradaEn && Boolean(nuevaCerradaEn);
  return { vendedorId: demoActualizada.vendedorId, seCerroRecienAhora };
}

// Llamar DESPUÉS de que el prisma.$transaction que llamó a
// recomputarDerivadosDemo ya haya resuelto — nunca desde dentro de la
// transacción, porque el conteo de casos activos necesita ver el cierre ya
// commiteado. No bloquea la respuesta al vendedor.
function repoblarSiCorresponde({ vendedorId, seCerroRecienAhora }) {
  if (!seCerroRecienAhora || !vendedorId) return;
  intentarRepoblarCupo(vendedorId).catch((err) => {
    console.error(`[gestion-venta] Error repoblando cupo del vendedor ${vendedorId}:`, err);
  });
}

async function obtenerDemoConPermiso(demoId, req) {
  const demo = await prisma.demoAsignada.findUnique({ where: { id: demoId } });
  if (!demo || demo.eliminadoEn) return null;
  const esAdmin = req.usuario.rolVendedor === 'ADMIN';
  if (!esAdmin && demo.vendedorId !== req.usuario.vendedorId) return null;
  return demo;
}

// ------------------------------------------------------------
// GET /gestion-venta/catalogo — listas cerradas para armar el árbol en el
// frontend, sin duplicar los catálogos ahí.
// ------------------------------------------------------------
router.get('/catalogo', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  res.json({ resultadosPorCanal: CATALOGO_RESULTADOS, motivosDescarte: CATALOGO_MOTIVOS_DESCARTE });
});

// ------------------------------------------------------------
// GET /gestion-venta/:demoId/eventos — vista cronológica de una demo.
// ------------------------------------------------------------
router.get('/:demoId/eventos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demo = await obtenerDemoConPermiso(req.params.demoId, req);
    if (!demo) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }

    const eventos = await prisma.eventoGestionVenta.findMany({
      where: { demoAsignadaId: demo.id },
      orderBy: { creadoEn: 'desc' },
      include: { vendedor: { select: { nombre: true } } },
    });

    res.json({
      eventos: eventos.map((e) => ({
        id: e.id,
        canal: e.canal,
        resultado: e.resultado,
        motivoDescarte: e.motivoDescarte,
        reseteaTimer: e.reseteaTimer,
        vendedorNombre: e.vendedor.nombre,
        creadoEn: e.creadoEn,
        actualizadoEn: e.actualizadoEn,
      })),
    });
  } catch (error) {
    console.error('Error listando eventos de gestión:', error);
    res.status(500).json({ error: 'Error al listar los eventos' });
  }
});

// Valida {canal, resultado, motivoDescarte} contra el catálogo cerrado.
// Devuelve { ok: true, config } o { ok: false, error }.
function validarEvento({ canal, resultado, motivoDescarte }) {
  if (!CATALOGO_RESULTADOS[canal]) {
    return { ok: false, error: `Canal inválido: ${canal}` };
  }
  const config = obtenerResultado(canal, resultado);
  if (!config) {
    return { ok: false, error: `Resultado inválido para el canal ${canal}: ${resultado}` };
  }
  if (config.esCierre) {
    if (!motivoDescarte || !esMotivoDescarteValido(motivoDescarte)) {
      return { ok: false, error: 'Falta un motivo de descarte válido para "Cerrado — perdido"' };
    }
  } else if (motivoDescarte) {
    return { ok: false, error: 'motivoDescarte solo aplica cuando el resultado es "Cerrado — perdido"' };
  }
  return { ok: true, config };
}

// ------------------------------------------------------------
// POST /gestion-venta/:demoId/eventos — registra una acción de gestión.
// body: { canal, resultado, motivoDescarte? }
// Nunca toca rankingService.js/Suscripcion — solo EventoGestionVenta y los
// campos derivados de DemoAsignada (primerContactoVendedorEn/
// ultimoContactoEfectivoEn/cerradaEn), en una sola transacción.
// ------------------------------------------------------------
router.post('/:demoId/eventos', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const demo = await obtenerDemoConPermiso(req.params.demoId, req);
    if (!demo) {
      return res.status(404).json({ error: 'Demo no encontrada' });
    }

    const { canal, resultado, motivoDescarte } = req.body;
    const validacion = validarEvento({ canal, resultado, motivoDescarte });
    if (!validacion.ok) {
      return res.status(400).json({ error: validacion.error });
    }

    const { evento, senalRepoblar } = await prisma.$transaction(async (tx) => {
      const nuevoEvento = await tx.eventoGestionVenta.create({
        data: {
          demoAsignadaId: demo.id,
          vendedorId: req.usuario.vendedorId,
          canal,
          resultado,
          motivoDescarte: motivoDescarte || null,
          reseteaTimer: validacion.config.reseteaTimer,
        },
      });
      const senalRepoblar = await recomputarDerivadosDemo(demo.id, tx);
      return { evento: nuevoEvento, senalRepoblar };
    });
    repoblarSiCorresponde(senalRepoblar);

    res.json({ ok: true, evento });
  } catch (error) {
    console.error('Error creando evento de gestión:', error);
    res.status(500).json({ error: 'Error al registrar la gestión' });
  }
});

// ------------------------------------------------------------
// PATCH /gestion-venta/eventos/:id — corrige un evento existente (editable
// individualmente, per diseño). Recalcula los campos derivados de la demo
// porque el evento corregido puede haber cambiado reseteaTimer/cierre.
// ------------------------------------------------------------
router.patch('/eventos/:id', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const eventoExistente = await prisma.eventoGestionVenta.findUnique({ where: { id: req.params.id } });
    if (!eventoExistente) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    const demo = await obtenerDemoConPermiso(eventoExistente.demoAsignadaId, req);
    if (!demo) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const canal = req.body.canal || eventoExistente.canal;
    const resultado = req.body.resultado || eventoExistente.resultado;
    // Si el resultado (nuevo o el que ya tenía) ya no es un cierre, el
    // motivoDescarte viejo no debe sobrevivir al cambio — sin esto, editar
    // un evento "Cerrado - perdido" hacia otro resultado dejaba pegado el
    // motivo de descarte anterior.
    const configCandidato = obtenerResultado(canal, resultado);
    const motivoDescarte = configCandidato?.esCierre
      ? (req.body.motivoDescarte !== undefined ? req.body.motivoDescarte : eventoExistente.motivoDescarte)
      : null;

    const validacion = validarEvento({ canal, resultado, motivoDescarte });
    if (!validacion.ok) {
      return res.status(400).json({ error: validacion.error });
    }

    const { evento, senalRepoblar } = await prisma.$transaction(async (tx) => {
      const actualizado = await tx.eventoGestionVenta.update({
        where: { id: eventoExistente.id },
        data: { canal, resultado, motivoDescarte: motivoDescarte || null, reseteaTimer: validacion.config.reseteaTimer },
      });
      const senalRepoblar = await recomputarDerivadosDemo(demo.id, tx);
      return { evento: actualizado, senalRepoblar };
    });
    repoblarSiCorresponde(senalRepoblar);

    res.json({ ok: true, evento });
  } catch (error) {
    console.error('Error editando evento de gestión:', error);
    res.status(500).json({ error: 'Error al editar la gestión' });
  }
});

// ------------------------------------------------------------
// DELETE /gestion-venta/eventos/:id
// ------------------------------------------------------------
router.delete('/eventos/:id', requireAuth, requireRole('VENDEDOR'), async (req, res) => {
  try {
    const eventoExistente = await prisma.eventoGestionVenta.findUnique({ where: { id: req.params.id } });
    if (!eventoExistente) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    const demo = await obtenerDemoConPermiso(eventoExistente.demoAsignadaId, req);
    if (!demo) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const senalRepoblar = await prisma.$transaction(async (tx) => {
      await tx.eventoGestionVenta.delete({ where: { id: eventoExistente.id } });
      return recomputarDerivadosDemo(demo.id, tx);
    });
    repoblarSiCorresponde(senalRepoblar);

    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando evento de gestión:', error);
    res.status(500).json({ error: 'Error al eliminar la gestión' });
  }
});

module.exports = router;
