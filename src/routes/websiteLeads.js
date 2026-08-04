// ============================================================
// Endpoint: POST /website-leads
// Recibe datos del formulario de contacto del sitio web
// Guarda en BD + envía email automático vía Resend
// ============================================================

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { Resend } = require("resend");

const router = express.Router();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /website-leads
 * Body: { nombre, email, telefono, mensaje }
 * Response: { exito: true, id } | { error: "..." }
 */
router.post("/website-leads", async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;

    // Validar campos requeridos
    if (!nombre || !email || !telefono || !mensaje) {
      return res.status(400).json({
        error: "Campos requeridos: nombre, email, telefono, mensaje",
      });
    }

    // Validar formato email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    // Guardar en BD
    const lead = await prisma.websiteLeads.create({
      data: {
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        telefono: telefono.trim(),
        mensaje: mensaje.trim(),
        empresaId: "ahoroptica-lautaro-seed-id",
      },
    });

    // Enviar email vía Resend
    await resend.emails.send({
      from: "noreply@ohparis.cl",
      to: process.env.ADMIN_EMAIL,
      subject: `📬 Nuevo lead del sitio web: ${nombre}`,
      html: `
        <h2>Nuevo mensaje del sitio web</h2>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Teléfono:</strong> <a href="tel:${telefono}">${telefono}</a></p>
        <p><strong>Mensaje:</strong></p>
        <p style="background: #f5f5f5; padding: 15px; border-left: 4px solid #2F6F62;">
          ${mensaje.replace(/\n/g, "<br>")}
        </p>
        <hr>
        <p style="font-size: 12px; color: #666;">
          ID del lead: <code>${lead.id}</code><br>
          Fecha: ${new Date(lead.creadoEn).toLocaleString("es-CL")}
        </p>
      `,
    });

    res.status(200).json({
      exito: true,
      id: lead.id,
      mensaje: "Formulario enviado correctamente. Te contactaremos pronto.",
    });
  } catch (error) {
    console.error("Error en POST /website-leads:", error);

    if (error.code && error.code.startsWith("P")) {
      return res.status(400).json({ error: "Error al guardar el formulario" });
    }

    res.status(500).json({
      error: "Error al procesar el formulario. Intenta más tarde.",
    });
  }
});

router.get("/website-leads/admin", async (req, res) => {
  try {
    const leads = await prisma.websiteLeads.findMany({
      orderBy: { creadoEn: "desc" },
      take: 100,
    });
    res.status(200).json({ leads });
  } catch (error) {
    console.error("Error en GET /website-leads/admin:", error);
    res.status(500).json({ error: "Error al obtener leads" });
  }
});

router.patch("/website-leads/:id/marcar-leido", async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.websiteLeads.update({
      where: { id },
      data: { leido: true, respondidoEn: new Date() },
    });
    res.status(200).json({ exito: true, lead });
  } catch (error) {
    console.error("Error en PATCH /website-leads/:id/marcar-leido:", error);
    res.status(500).json({ error: "Error al actualizar lead" });
  }
});

module.exports = router;