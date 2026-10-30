// Visitas a las demos de muestras.multidigital.cl (2026-10-30, pedido de Rubén).
//
// POST /visitas-demo  {slug, dispositivo}  — público, lo llama muestras/visita.js desde
//   cada demo tras 5 s con la página a la vista. Guarda la visita y, si es la primera
//   del día (hora Chile) de esa demo, le avisa a Rubén por WhatsApp con la plantilla
//   alerta_visita_demo (ver scripts/crear-plantilla-aviso-visita-demo.js). Nunca le
//   escribe al prospecto.
// GET /visitas-demo?desde=YYYY-MM-DD  — con header x-clave = VISITAS_DEMO_CLAVE; lo usa
//   seguimiento.py (multidigital-tools) para elegir el texto del seguimiento.
//
// Las vistas previas de WhatsApp/Facebook no ejecutan JavaScript, así que no llegan
// acá; igual se descartan por user-agent los bots que sí lo ejecutan.

const express = require('express');
const prisma = require('../lib/prisma');
const { sendWhatsAppTemplateMessage } = require('../services/whatsapp');
const { fechaISOEnChile, horaChileAFechaUTC } = require('../lib/horaChile');

const router = express.Router();

const ORIGEN_MUESTRAS = 'https://muestras.multidigital.cl';
const TEMPLATE_AVISO_VISITA = 'alerta_visita_demo'; // debe existir y estar aprobada en Meta (aviso_visita_demo fue rechazada)
const PATRON_SLUG = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const PATRON_BOT = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|preview|headless|lighthouse|slurp/i;
const MAX_VISITAS_POR_IP_HORA = 30;

// Freno simple contra abuso del endpoint público (se reinicia con cada deploy, basta).
const visitasPorIp = new Map();
function superaLimite(ip, ahora = Date.now()) {
  const recientes = (visitasPorIp.get(ip) || []).filter((t) => ahora - t < 3600000);
  recientes.push(ahora);
  visitasPorIp.set(ip, recientes);
  return recientes.length > MAX_VISITAS_POR_IP_HORA;
}

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ORIGEN_MUESTRAS);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function avisarARuben(slug, dispositivo) {
  const phoneNumberId = process.env.DEMO_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_WHATSAPP_ACCESS_TOKEN;
  const telefono = process.env.VISITAS_DEMO_AVISO_TELEFONO;
  if (!phoneNumberId || !accessToken || !telefono) {
    console.warn(`[VISITAS-DEMO] Primera visita de hoy a ${slug} (${dispositivo}), sin aviso: falta VISITAS_DEMO_AVISO_TELEFONO o la config de plataforma.`);
    return;
  }
  try {
    await sendWhatsAppTemplateMessage({
      phoneNumberId,
      accessToken,
      to: telefono,
      templateName: TEMPLATE_AVISO_VISITA,
      variables: [`${slug}.html`, dispositivo],
    });
  } catch (error) {
    console.error(`[VISITAS-DEMO] No se pudo avisar la visita a ${slug}:`, error.message);
  }
}

router.post('/', express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const slug = String(req.body?.slug || '').replace(/\.html$/i, '');
    const dispositivo = req.body?.dispositivo === 'celular' ? 'celular' : 'computador';
    if (!PATRON_SLUG.test(slug)) return res.sendStatus(400);
    if (PATRON_BOT.test(req.get('user-agent') || '')) return res.sendStatus(204);
    if (superaLimite(req.ip)) return res.sendStatus(429);

    const inicioDelDia = horaChileAFechaUTC(fechaISOEnChile(), '00:00');
    const yaHabiaHoy = await prisma.visitaDemo.count({ where: { slug, creadoEn: { gte: inicioDelDia } } });
    await prisma.visitaDemo.create({ data: { slug, dispositivo } });
    if (yaHabiaHoy === 0) avisarARuben(slug, dispositivo); // sin await: no demora la respuesta, nunca lanza

    res.sendStatus(204);
  } catch (error) {
    console.error('[VISITAS-DEMO] Error registrando la visita:', error.message);
    res.sendStatus(500);
  }
});

router.get('/', async (req, res) => {
  const clave = process.env.VISITAS_DEMO_CLAVE;
  if (!clave || req.get('x-clave') !== clave) return res.sendStatus(401);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? horaChileAFechaUTC(req.query.desde, '00:00') : new Date(Date.now() - 30 * 86400000);
  const filas = await prisma.visitaDemo.groupBy({
    by: ['slug'],
    where: { creadoEn: { gte: desde } },
    _count: { _all: true },
    _max: { creadoEn: true },
  });
  res.json(filas.map((f) => ({ slug: f.slug, visitas: f._count._all, ultima: f._max.creadoEn })));
});

module.exports = router;
module.exports.superaLimite = superaLimite;
